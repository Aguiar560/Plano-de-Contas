'use strict';

const express = require('express');

module.exports = function lancamentosRoutes({ db, logger, audit, Joi, readLimiter, writeLimiter, jwtMiddleware, requireRole, _decodeMojibake }) {
  const router = express.Router();

  router.get('/lancamentos', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const qSchema = Joi.object({
      conta_id: Joi.number().integer().positive().required(),
      page:     Joi.number().integer().min(1).default(1),
      limit:    Joi.number().integer().min(1).max(200).default(50),
      dtI:      Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(''),
      dtF:      Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(''),
      busca:    Joi.string().max(200).optional().allow(''),
      ordem:    Joi.string().valid('data-desc','data-asc','valor-desc','valor-asc').default('data-desc')
    });
    const { error: vErr, value: q } = qSchema.validate(req.query, { abortEarly: true, stripUnknown: true });
    if (vErr) return res.status(400).json({ ok:false, erro: vErr.details[0].message });

    try {
      const contas = await db.query(
        'SELECT id FROM conta WHERE empresa_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
        [empresaId, q.conta_id]
      );
      if (!contas.length) return res.status(404).json({ ok:false, erro:'Conta não encontrada' });

      const where = ['l.empresa_id = ?', 'l.conta_id = ?', 'l.deleted_at IS NULL'];
      const params = [empresaId, q.conta_id];
      if (q.dtI) { where.push('l.data >= ?'); params.push(q.dtI); }
      if (q.dtF) { where.push('l.data <= ?'); params.push(q.dtF); }
      if (q.busca && q.busca.trim()) { where.push('l.descricao LIKE ?'); params.push(`%${q.busca.trim()}%`); }

      const orderMap = { 'data-desc':'l.data DESC, l.id DESC', 'data-asc':'l.data ASC, l.id ASC', 'valor-desc':'l.valor DESC', 'valor-asc':'l.valor ASC' };
      const orderBy = orderMap[q.ordem] || 'l.data DESC, l.id DESC';

      const [{ total }] = await db.query(
        `SELECT COUNT(*) AS total FROM lancamento l WHERE ${where.join(' AND ')}`,
        params
      );

      const offset = (q.page - 1) * q.limit;
      const rows = await db.query(
        `SELECT l.id, l.conta_id, l.data, l.tipo, l.valor, l.descricao, l.fornecedor_id
         FROM lancamento l
         WHERE ${where.join(' AND ')}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [...params, q.limit, offset]
      );

      const lancamentos = rows.map(l => ({
        id:            l.id,
        conta_id:      l.conta_id,
        tipo:          l.tipo,
        valor:         parseFloat(l.valor),
        descricao:     _decodeMojibake(l.descricao || ''),
        data:          l.data instanceof Date ? l.data.toISOString().slice(0,10) : String(l.data).slice(0,10),
        fornecedor_id: l.fornecedor_id || null
      }));

      res.json({ ok:true, lancamentos, total: Number(total), page: q.page, limit: q.limit, pages: Math.ceil(Number(total) / q.limit) });
    } catch(e){ logger.error('GET /api/lancamentos falhou', { err: e && e.message }); res.status(500).json({ ok:false, erro:'DB error' }); }
  });

  router.post('/lancamentos', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const lancSchema = Joi.object({
      conta_codigo:   Joi.string().max(50).required(),
      conta_ext_id:   Joi.string().max(50).optional(),
      conta_nome:     Joi.string().max(200).optional().allow(''),
      conta_natureza: Joi.string().max(50).optional().allow(''),
      data:           Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required().messages({
                        'string.pattern.base': '"data" deve estar no formato YYYY-MM-DD'
                      }),
      tipo:           Joi.string().valid('credito', 'debito').required(),
      valor:          Joi.number().positive().required(),
      descricao:      Joi.string().max(500).optional().allow('', null),
      fornecedor_id:  Joi.number().integer().positive().optional().allow(null)
    });
    const { error, value: body } = lancSchema.validate(req.body, { abortEarly: true, stripUnknown: true });
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });

    const { conta_codigo, conta_ext_id, conta_nome, conta_natureza, data, tipo, valor, descricao, fornecedor_id } = body;

    try {
      let dbContaId = null;

      if (conta_codigo) {
        const rows = await db.query(
          'SELECT id FROM conta WHERE empresa_id = ? AND codigo = ? LIMIT 1',
          [empresaId, String(conta_codigo)]
        );
        if (rows.length > 0) dbContaId = rows[0].id;
      }

      if (!dbContaId && conta_ext_id !== undefined && conta_ext_id !== null) {
        const extKey = String(conta_ext_id);
        const rows = await db.query(
          'SELECT id FROM conta WHERE empresa_id = ? AND codigo = ? LIMIT 1',
          [empresaId, extKey]
        );
        if (rows.length > 0) {
          dbContaId = rows[0].id;
        } else if (conta_nome) {
          const partes = extKey.split('.');
          let parentId = null;
          if (partes.length > 1) {
            const codigoPai = partes.slice(0, -1).join('.');
            const [pai] = await db.query(
              'SELECT id FROM conta WHERE empresa_id = ? AND codigo = ? LIMIT 1',
              [empresaId, codigoPai]
            );
            if (pai) parentId = pai.id;
          }
          const nat = conta_natureza === 'Entrada' ? 'entrada' : 'saida';
          const ins = await db.execute(
            'INSERT INTO conta (empresa_id, parent_id, codigo, nome, natureza, created_at) VALUES (?,?,?,?,?,NOW())',
            [empresaId, parentId, extKey, String(conta_nome).toUpperCase().trim(), nat]
          );
          dbContaId = ins.insertId;
        }
      }

      if (!dbContaId) return res.status(400).json({ ok:false, erro:'Conta não identificada' });

      const r = await db.execute(
        'INSERT INTO lancamento (empresa_id,conta_id,data,tipo,valor,descricao,fornecedor_id,created_at) VALUES (?,?,?,?,?,?,?,NOW())',
        [empresaId, dbContaId, data, tipo, valor, descricao||null, fornecedor_id||null]
      );
      await audit(req, 'lancamento_criado', 'lancamento', r.insertId, { conta_codigo, data, tipo, valor, descricao: descricao || null, fornecedor_id: fornecedor_id || null });
      res.json({ ok:true, id: r.insertId });
    } catch(e){ logger.error('POST /api/lancamentos falhou', { err: e && e.message }); res.status(500).json({ ok:false, erro:'DB error' }); }
  });

  router.put('/lancamentos/:id', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });

    const editSchema = Joi.object({
      data:          Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required().messages({
                       'string.pattern.base': '"data" deve estar no formato YYYY-MM-DD'
                     }),
      tipo:          Joi.string().valid('credito', 'debito').required(),
      valor:         Joi.number().positive().required(),
      descricao:     Joi.string().max(500).optional().allow('', null),
      fornecedor_id: Joi.number().integer().positive().optional().allow(null)
    });
    const { error, value: body } = editSchema.validate(req.body, { abortEarly: true, stripUnknown: true });
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });

    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[row]] = await conn.query(
        'SELECT id, data, tipo, valor, descricao, fornecedor_id FROM lancamento WHERE empresa_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [empresaId, id]
      );
      if (!row) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Lançamento não encontrado' }); }
      const before = {
        data:          row.data instanceof Date ? row.data.toISOString().slice(0,10) : String(row.data).slice(0,10),
        tipo:          row.tipo,
        valor:         parseFloat(row.valor),
        descricao:     row.descricao,
        fornecedor_id: row.fornecedor_id || null
      };
      let fornId = body.fornecedor_id !== undefined ? (body.fornecedor_id || null) : (row.fornecedor_id || null);
      // Valida que fornecedor_id pertence à mesma empresa antes de persistir
      if (fornId) {
        const [[forn]] = await conn.query(
          "SELECT id FROM fornecedor WHERE id = ? AND empresa_id = ? AND status != 'excluido' LIMIT 1",
          [fornId, empresaId]
        );
        if (!forn) { await conn.rollback(); return res.status(400).json({ ok:false, erro:'Fornecedor não encontrado' }); }
      }
      await conn.execute(
        'UPDATE lancamento SET data=?, tipo=?, valor=?, descricao=?, fornecedor_id=?, updated_at=NOW() WHERE id=? AND empresa_id=?',
        [body.data, body.tipo, body.valor, body.descricao || null, fornId, id, empresaId]
      );
      await conn.commit();
      await audit(req, 'lancamento_editado', 'lancamento', id, { before, after: { data: body.data, tipo: body.tipo, valor: body.valor, descricao: body.descricao || null, fornecedor_id: fornId } });
      res.json({ ok:true, id, ...body });
    } catch(e) {
      await conn.rollback();
      logger.error('PUT /api/lancamentos falhou', { err: e && e.message, id: req.params.id });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  router.delete('/lancamentos/:id', writeLimiter, jwtMiddleware, requireRole('gerente'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    try {
      const rows = await db.query(
        'SELECT id FROM lancamento WHERE empresa_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
        [empresaId, id]
      );
      if (!rows.length) return res.status(404).json({ ok:false, erro:'Lançamento não encontrado' });
      await db.execute('UPDATE lancamento SET deleted_at = NOW() WHERE id = ? AND empresa_id = ?', [id, empresaId]);
      await audit(req, 'lancamento_deletado', 'lancamento', id, { id });
      res.json({ ok:true, id });
    } catch(e){ logger.error('DELETE /api/lancamentos falhou', { err: e && e.message, id: req.params.id }); res.status(500).json({ ok:false, erro:'DB error' }); }
  });

  return router;
};
