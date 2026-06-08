'use strict';

const express = require('express');

module.exports = function contasRoutes({ db, logger, audit, Joi, readLimiter, writeLimiter, jwtMiddleware, requireAdmin, requireRole, _decodeMojibake, cryptoUtils }) {
  const router = express.Router();

  // ETag: baseado no timestamp mais recente da empresa
  async function _computeHash(empresaId) {
    const [[{ ts }]] = await db.pool.query(`
      SELECT GREATEST(
        COALESCE((SELECT MAX(created_at)  FROM conta      WHERE empresa_id = ?), '2000-01-01'),
        COALESCE((SELECT MAX(updated_at)  FROM conta      WHERE empresa_id = ?), '2000-01-01'),
        COALESCE((SELECT MAX(deleted_at)  FROM conta      WHERE empresa_id = ?), '2000-01-01'),
        COALESCE((SELECT MAX(created_at)  FROM lancamento WHERE empresa_id = ?), '2000-01-01'),
        COALESCE((SELECT MAX(updated_at)  FROM lancamento WHERE empresa_id = ?), '2000-01-01'),
        COALESCE((SELECT MAX(deleted_at)  FROM lancamento WHERE empresa_id = ?), '2000-01-01')
      ) AS ts
    `, [empresaId, empresaId, empresaId, empresaId, empresaId, empresaId]);
    return ts ? (ts instanceof Date ? String(ts.getTime()) : String(ts)) : '0';
  }

  router.get('/contas', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const anoParam = parseInt(req.query.ano, 10);
    const ano = (anoParam >= 2000 && anoParam <= 2100) ? anoParam : new Date().getFullYear();
    try {
      try {
        const h = await _computeHash(empresaId);
        const etag = `"${h}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, no-cache');
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
      } catch(e) { /* ETag opcional */ }

      const rows = await db.query(
        'SELECT id, parent_id, codigo, nome, natureza, orcamento, ordem FROM conta WHERE empresa_id = ? AND deleted_at IS NULL ORDER BY codigo',
        [empresaId]
      );
      const lancs = await db.query(
        'SELECT id, conta_id, data, tipo, valor, descricao, fornecedor_id FROM lancamento WHERE empresa_id = ? AND deleted_at IS NULL AND YEAR(data) = ? ORDER BY data, id',
        [empresaId, ano]
      );

      const lancMap = {};
      lancs.forEach(l => {
        if (!lancMap[l.conta_id]) lancMap[l.conta_id] = [];
        const dataStr = l.data instanceof Date ? l.data.toISOString().slice(0, 10) : String(l.data).slice(0, 10);
        lancMap[l.conta_id].push({
          id:            l.id,
          tipo:          l.tipo,
          valor:         parseFloat(l.valor),
          descricao:     _decodeMojibake(l.descricao || ''),
          data:          dataStr,
          fornecedor_id: l.fornecedor_id || null
        });
      });

      const map = {};
      rows.forEach(r => { map[r.id] = { ...r, nome: _decodeMojibake(r.nome), filhos: [], lancamentos: lancMap[r.id] || [] }; });
      const raizes = [];
      rows.forEach(r => {
        if (r.parent_id && map[r.parent_id]) map[r.parent_id].filhos.push(map[r.id]);
        else raizes.push(map[r.id]);
      });
      res.json({ ok:true, ano, contas: raizes });
    } catch(e){ logger.error('GET /api/contas falhou', { err: e && e.message }); res.status(500).json({ ok:false, erro:'DB error' }); }
  });

  router.get('/contas/hash', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.json({ ok:true, hash: '0' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.json({ ok:true, hash: '0' });
    try {
      const hash = await _computeHash(empresaId);
      res.json({ ok:true, hash });
    } catch(e) {
      logger.error('GET /api/contas/hash falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'DB error' });
    }
  });

  router.post('/admin/re-encrypt', jwtMiddleware, requireAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    if (!cryptoUtils || !cryptoUtils.reEncrypt) return res.status(501).json({ ok:false, erro:'reEncrypt não disponível' });
    const { reEncrypt } = cryptoUtils;

    let updated = 0;
    let skipped = 0;
    let errors  = 0;
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Re-criptografa CPF/CNPJ de fornecedores da empresa
      const forns = await conn.query(
        'SELECT id, cpf, cnpj FROM fornecedor WHERE empresa_id = ? AND (cpf IS NOT NULL OR cnpj IS NOT NULL)',
        [empresaId]
      );
      for (const f of forns) {
        const patch = {};
        for (const col of ['cpf', 'cnpj']) {
          if (!f[col]) continue;
          const next = reEncrypt(f[col]);
          if (next === null) { errors++; continue; }
          if (next === f[col]) { skipped++; continue; }
          patch[col] = next;
          updated++;
        }
        if (Object.keys(patch).length) {
          await conn.query('UPDATE fornecedor SET ? WHERE id = ? AND empresa_id = ?', [patch, f.id, empresaId]);
        }
      }

      // Re-criptografa CPF em recibos da empresa
      const recibos = await conn.query(
        'SELECT id, fornecedor_cpf FROM recibo WHERE empresa_id = ? AND fornecedor_cpf IS NOT NULL',
        [empresaId]
      );
      for (const r of recibos) {
        const next = reEncrypt(r.fornecedor_cpf);
        if (next === null) { errors++; continue; }
        if (next === r.fornecedor_cpf) { skipped++; continue; }
        await conn.query('UPDATE recibo SET fornecedor_cpf = ? WHERE id = ? AND empresa_id = ?', [next, r.id, empresaId]);
        updated++;
      }

      await conn.commit();
      await audit(req, 're_encrypt', 'dados_pessoais', null, {
        empresaId, updated, skipped, errors,
        targetVersion: parseInt(process.env.ENCRYPT_KEY_VERSION || '1', 10)
      });
      res.json({ ok:true, updated, skipped, errors });
    } catch(e) {
      await conn.rollback();
      logger.error('POST /api/admin/re-encrypt falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro na re-criptografia' });
    } finally {
      conn.release();
    }
  });

  router.post('/admin/fix-encoding', jwtMiddleware, requireAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    try {
      var p = 'C[23][89AB][0-9A-Fa-f]';
      var [rC] = await db.pool.query(
        'UPDATE conta SET nome = CONVERT(BINARY CONVERT(nome USING latin1) USING utf8)' +
        ' WHERE empresa_id = ? AND HEX(nome) REGEXP ?', [empresaId, p]
      );
      var [rL] = await db.pool.query(
        'UPDATE lancamento SET descricao = CONVERT(BINARY CONVERT(descricao USING latin1) USING utf8)' +
        ' WHERE empresa_id = ? AND descricao IS NOT NULL AND LENGTH(descricao) > 0 AND HEX(descricao) REGEXP ?', [empresaId, p]
      );
      var fixedContas = rC.affectedRows || 0;
      var fixedLancs  = rL.affectedRows  || 0;
      await audit(req, 'fix_encoding', 'conta', null, { fixedContas, fixedLancs });
      res.json({ ok:true, fixedContas, fixedLancs });
    } catch(e) { logger.error('fix_encoding falhou', { err: e && e.message }); res.status(500).json({ ok:false, erro: e.message }); }
  });

  router.post('/contas', writeLimiter, jwtMiddleware, requireRole('gerente'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const contaSchema = Joi.object({
      parent_codigo: Joi.string().max(50).optional().allow('', null),
      nome:          Joi.string().trim().min(1).max(200).required().messages({ 'any.required': 'nome obrigatório', 'string.empty': 'nome obrigatório' }),
      natureza:      Joi.string().valid('entrada', 'saida', 'Entrada', 'Saída', 'saída').optional().allow('', null)
    });
    const { error: vErr, value: body } = contaSchema.validate(req.body, { abortEarly: true, stripUnknown: true });
    if (vErr) return res.status(400).json({ ok:false, erro: vErr.details[0].message });

    const { parent_codigo, nome, natureza } = body;
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      let parentId = null, novoCodigo;

      if (parent_codigo) {
        const [[pai]] = await conn.query(
          'SELECT id, codigo FROM conta WHERE empresa_id = ? AND codigo = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
          [empresaId, parent_codigo]
        );
        if (!pai) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Conta pai não encontrada: ' + parent_codigo }); }
        parentId = pai.id;
        const [[{ maxSeg }]] = await conn.query(
          `SELECT MAX(CAST(SUBSTRING_INDEX(codigo, '.', -1) AS UNSIGNED)) AS maxSeg
           FROM conta WHERE empresa_id = ? AND parent_id = ?`, [empresaId, parentId]
        );
        novoCodigo = pai.codigo + '.' + ((maxSeg || 0) + 1);
      } else {
        const [[{ maxSeg }]] = await conn.query(
          `SELECT MAX(CAST(codigo AS UNSIGNED)) AS maxSeg FROM conta WHERE empresa_id = ? AND parent_id IS NULL`,
          [empresaId]
        );
        novoCodigo = String((maxSeg || 0) + 1);
      }

      const nat = natureza === 'entrada' ? 'entrada' : 'saida';
      const [r] = await conn.execute(
        'INSERT INTO conta (empresa_id, parent_id, codigo, nome, natureza, created_at) VALUES (?,?,?,?,?,NOW())',
        [empresaId, parentId, novoCodigo, nome.toUpperCase().trim(), nat]
      );
      await conn.commit();
      await audit(req, 'conta_criada', 'conta', novoCodigo, { codigo: novoCodigo, nome: nome.toUpperCase().trim(), natureza: nat, parent_codigo: parent_codigo || null });
      res.json({ ok:true, id: r.insertId, codigo: novoCodigo });
    } catch(e) {
      await conn.rollback();
      logger.error('POST /api/contas falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  router.put('/contas/:codigo', writeLimiter, jwtMiddleware, requireRole('gerente'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const codigo = req.params.codigo;
    if (!codigo || !codigo.trim()) return res.status(400).json({ ok:false, erro:'código inválido' });

    const renameSchema = Joi.object({
      nome:      Joi.string().min(1).max(200).optional(),
      orcamento: Joi.number().min(0).optional().allow(null)
    }).or('nome', 'orcamento').messages({ 'object.missing': 'Informe nome ou orcamento' });
    const { error: vErr, value: body } = renameSchema.validate(req.body, { abortEarly: true, stripUnknown: true });
    if (vErr) return res.status(400).json({ ok:false, erro: vErr.details[0].message });

    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[row]] = await conn.query(
        'SELECT id, nome, orcamento FROM conta WHERE empresa_id = ? AND codigo = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [empresaId, codigo]
      );
      if (!row) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Conta não encontrada: ' + codigo }); }
      const before = { nome: row.nome, orcamento: row.orcamento };
      const fields = [];
      const params = [];
      if (body.nome !== undefined) { fields.push('nome = ?'); params.push(body.nome.toUpperCase().trim()); }
      if (body.orcamento !== undefined) { fields.push('orcamento = ?'); params.push(body.orcamento ?? null); }
      params.push(row.id);
      params.push(empresaId);
      fields.push('updated_at = NOW()');
      await conn.execute(`UPDATE conta SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, params);
      await conn.commit();
      const after = { ...(body.nome !== undefined && { nome: body.nome.toUpperCase().trim() }), ...(body.orcamento !== undefined && { orcamento: body.orcamento ?? null }) };
      await audit(req, 'conta_editada', 'conta', codigo, { before, after });
      res.json({ ok:true, codigo, ...(body.nome !== undefined && { nome: body.nome.toUpperCase().trim() }) });
    } catch(e) {
      await conn.rollback();
      logger.error('PUT /api/contas falhou', { err: e && e.message, codigo: req.params.codigo });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  router.delete('/contas/:codigo', writeLimiter, jwtMiddleware, requireAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const codigo = req.params.codigo;
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[conta]] = await conn.query(
        'SELECT id, nome FROM conta WHERE empresa_id = ? AND codigo = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [empresaId, codigo]
      );
      if (!conta) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Conta não encontrada: ' + codigo }); }

      const [[{ qtd }]] = await conn.query(
        'SELECT COUNT(*) AS qtd FROM conta WHERE empresa_id = ? AND parent_id = ? AND deleted_at IS NULL',
        [empresaId, conta.id]
      );
      if (qtd > 0) { await conn.rollback(); return res.status(409).json({ ok:false, erro:`Conta "${conta.nome}" possui ${qtd} subconta(s) ativa(s). Remova-as primeiro.` }); }

      await conn.execute('UPDATE conta SET deleted_at = NOW() WHERE id = ? AND empresa_id = ?', [conta.id, empresaId]);
      await conn.execute('UPDATE lancamento SET deleted_at = NOW() WHERE empresa_id = ? AND conta_id = ? AND deleted_at IS NULL', [empresaId, conta.id]);
      await conn.commit();
      await audit(req, 'conta_deletada', 'conta', codigo, { codigo, nome: conta.nome });
      res.json({ ok:true, codigo, nome: conta.nome });
    } catch(e) {
      await conn.rollback();
      logger.error('DELETE /api/contas falhou', { err: e && e.message, codigo: req.params.codigo });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  return router;
};
