'use strict';

const express = require('express');

/**
 * lancamentosRoutes — lógica HTTP para /api/lancamentos.
 * SQL extraído para lancamentosRepo (injetado).
 *
 * CQRS: GET sem conta_id + com ano retorna todos os lançamentos do ano
 *       (usado pelo frontend após split de GET /api/contas).
 */
module.exports = function lancamentosRoutes({
  db, logger, audit, Joi,
  readLimiter, writeLimiter,
  jwtMiddleware, requireRole,
  _decodeMojibake,
  lancamentosRepo,
}) {
  const router = express.Router();

  function _formatLanc(l) {
    return {
      id:            l.id,
      conta_id:      l.conta_id,
      tipo:          l.tipo,
      valor:         parseFloat(l.valor),
      descricao:     _decodeMojibake(l.descricao || ''),
      data:          l.data instanceof Date ? l.data.toISOString().slice(0,10) : String(l.data).slice(0,10),
      fornecedor_id: l.fornecedor_id || null,
    };
  }

  // ── GET /api/lancamentos ─────────────────────────────────────────────────
  // Dois modos:
  //   1. ?conta_id=X — paginado por conta (comportamento original)
  //   2. ?ano=XXXX   — todos os lançamentos do ano sem filtro de conta (CQRS)

  router.get('/lancamentos', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const { conta_id: contaIdRaw, ano: anoRaw } = req.query;

    // ── Modo CQRS: ano sem conta_id ──────────────────────────────────────
    if (!contaIdRaw && anoRaw) {
      const ano = parseInt(anoRaw, 10);
      if (!ano || ano < 2000 || ano > 2100) {
        return res.status(400).json({ ok:false, erro:'"ano" inválido' });
      }
      try {
        const rows = await lancamentosRepo.listByYear(empresaId, ano);
        res.json({ ok:true, ano, lancamentos: rows.map(_formatLanc) });
      } catch(e) {
        logger.error('GET /api/lancamentos (ano) falhou', { err: e && e.message });
        res.status(500).json({ ok:false, erro:'DB error' });
      }
      return;
    }

    // ── Modo clássico: requer conta_id ───────────────────────────────────
    if (!contaIdRaw) {
      return res.status(400).json({ ok:false, erro:'conta_id ou ano é obrigatório' });
    }

    const qSchema = Joi.object({
      conta_id: Joi.number().integer().positive().required(),
      page:     Joi.number().integer().min(1).default(1),
      limit:    Joi.number().integer().min(1).max(200).default(50),
      dtI:      Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(''),
      dtF:      Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(''),
      busca:    Joi.string().max(200).optional().allow(''),
      ordem:    Joi.string().valid('data-desc','data-asc','valor-desc','valor-asc').default('data-desc'),
    });
    const { error: vErr, value: q } = qSchema.validate(req.query, { abortEarly:true, stripUnknown:true });
    if (vErr) return res.status(400).json({ ok:false, erro: vErr.details[0].message });

    try {
      const conta = await lancamentosRepo.findContaForQuery(empresaId, q.conta_id);
      if (!conta) return res.status(404).json({ ok:false, erro:'Conta não encontrada' });

      const { rows, total } = await lancamentosRepo.listByContaId(empresaId, q.conta_id, q);
      res.json({
        ok:true, lancamentos: rows.map(_formatLanc), total,
        page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit),
      });
    } catch(e) {
      logger.error('GET /api/lancamentos falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'DB error' });
    }
  });

  // ── POST /api/lancamentos ────────────────────────────────────────────────

  router.post('/lancamentos', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const schema = Joi.object({
      conta_codigo:   Joi.string().max(50).required(),
      conta_ext_id:   Joi.string().max(50).optional(),
      conta_nome:     Joi.string().max(200).optional().allow(''),
      conta_natureza: Joi.string().max(50).optional().allow(''),
      data:           Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
                        .messages({ 'string.pattern.base':'"data" deve estar no formato YYYY-MM-DD' }),
      tipo:           Joi.string().valid('credito','debito').required(),
      valor:          Joi.number().positive().required(),
      descricao:      Joi.string().max(500).optional().allow('', null),
      fornecedor_id:  Joi.number().integer().positive().optional().allow(null),
    });
    const { error, value: body } = schema.validate(req.body, { abortEarly:true, stripUnknown:true });
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });

    const { conta_codigo, conta_ext_id, conta_nome, conta_natureza, data, tipo, valor, descricao, fornecedor_id } = body;

    try {
      let dbContaId = null;

      if (conta_codigo) {
        const row = await lancamentosRepo.findContaByCodigo(empresaId, conta_codigo);
        if (row) dbContaId = row.id;
      }

      if (!dbContaId && conta_ext_id != null) {
        const extKey = String(conta_ext_id);
        const row = await lancamentosRepo.findContaByExtId(empresaId, extKey);
        if (row) {
          dbContaId = row.id;
        } else if (conta_nome) {
          const partes = extKey.split('.');
          let parentId = null;
          if (partes.length > 1) {
            const pai = await lancamentosRepo.findContaPai(empresaId, partes.slice(0,-1).join('.'));
            if (pai) parentId = pai.id;
          }
          const nat = conta_natureza === 'Entrada' ? 'entrada' : 'saida';
          dbContaId = await lancamentosRepo.insertConta(empresaId, parentId, extKey, conta_nome, nat);
        }
      }

      if (!dbContaId) return res.status(400).json({ ok:false, erro:'Conta não identificada' });

      const id = await lancamentosRepo.insert(empresaId, dbContaId, data, tipo, valor, descricao, fornecedor_id);
      await audit(req, 'lancamento_criado', 'lancamento', id, {
        conta_codigo, data, tipo, valor,
        descricao: descricao || null, fornecedor_id: fornecedor_id || null,
      });
      res.json({ ok:true, id });
    } catch(e) {
      logger.error('POST /api/lancamentos falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'DB error' });
    }
  });

  // ── PUT /api/lancamentos/:id ─────────────────────────────────────────────

  router.put('/lancamentos/:id', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });

    const schema = Joi.object({
      data:          Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
                       .messages({ 'string.pattern.base':'"data" deve estar no formato YYYY-MM-DD' }),
      tipo:          Joi.string().valid('credito','debito').required(),
      valor:         Joi.number().positive().required(),
      descricao:     Joi.string().max(500).optional().allow('', null),
      fornecedor_id: Joi.number().integer().positive().optional().allow(null),
    });
    const { error, value: body } = schema.validate(req.body, { abortEarly:true, stripUnknown:true });
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });

    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const row = await lancamentosRepo.findByIdForUpdate(conn, empresaId, id);
      if (!row) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Lançamento não encontrado' }); }

      let fornId = body.fornecedor_id !== undefined ? (body.fornecedor_id || null) : (row.fornecedor_id || null);
      if (fornId) {
        const forn = await lancamentosRepo.findFornecedor(empresaId, fornId);
        if (!forn) { await conn.rollback(); return res.status(400).json({ ok:false, erro:'Fornecedor não encontrado' }); }
      }

      const before = {
        data:          row.data instanceof Date ? row.data.toISOString().slice(0,10) : String(row.data).slice(0,10),
        tipo:          row.tipo,
        valor:         parseFloat(row.valor),
        descricao:     row.descricao,
        fornecedor_id: row.fornecedor_id || null,
      };
      await lancamentosRepo.update(conn, id, empresaId, {
        data: body.data, tipo: body.tipo, valor: body.valor,
        descricao: body.descricao, fornecedorId: fornId,
      });
      await conn.commit();
      await audit(req, 'lancamento_editado', 'lancamento', id, {
        before,
        after: { data: body.data, tipo: body.tipo, valor: body.valor, descricao: body.descricao || null, fornecedor_id: fornId },
      });
      res.json({ ok:true, id, ...body });
    } catch(e) {
      await conn.rollback();
      logger.error('PUT /api/lancamentos falhou', { err: e && e.message, id: req.params.id });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  // ── DELETE /api/lancamentos/:id ──────────────────────────────────────────

  router.delete('/lancamentos/:id', writeLimiter, jwtMiddleware, requireRole('gerente'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });

    try {
      const exists = await lancamentosRepo.exists(empresaId, id);
      if (!exists) return res.status(404).json({ ok:false, erro:'Lançamento não encontrado' });
      await lancamentosRepo.softDelete(empresaId, id);
      await audit(req, 'lancamento_deletado', 'lancamento', id, { id });
      res.json({ ok:true, id });
    } catch(e) {
      logger.error('DELETE /api/lancamentos falhou', { err: e && e.message, id: req.params.id });
      res.status(500).json({ ok:false, erro:'DB error' });
    }
  });

  return router;
};
