'use strict';

const express = require('express');

/**
 * contasRoutes — lógica HTTP para /api/contas.
 * SQL extraído para contasRepo (injetado). Sem query SQL direto aqui.
 *
 * CQRS: GET /api/contas retorna apenas estrutura (sem lançamentos).
 *       Lançamentos vêm de GET /api/lancamentos?ano=XXXX.
 */
module.exports = function contasRoutes({
  db, logger, audit, Joi,
  readLimiter, writeLimiter,
  jwtMiddleware, requireAdmin, requireRole,
  _decodeMojibake, cryptoUtils,
  contasRepo,
}) {
  const router = express.Router();

  // ── GET /api/contas — estrutura (sem lançamentos) ─────────────────────────

  router.get('/contas', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    try {
      // ETag baseado apenas em timestamps de estrutura (conta), não de lançamentos
      try {
        const h    = await contasRepo.computeHash(empresaId);
        const etag = `"${h}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, no-cache');
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
      } catch(e) { /* ETag é opcional */ }

      const rows = await contasRepo.listAll(empresaId);

      const map   = {};
      const raizes = [];
      rows.forEach(r => {
        map[r.id] = { ...r, nome: _decodeMojibake(r.nome), filhos: [] };
      });
      rows.forEach(r => {
        if (r.parent_id && map[r.parent_id]) map[r.parent_id].filhos.push(map[r.id]);
        else raizes.push(map[r.id]);
      });

      res.json({ ok:true, contas: raizes });
    } catch(e) {
      logger.error('GET /api/contas falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'DB error' });
    }
  });

  // ── GET /api/contas/hash — hash para verificação de cache ────────────────

  router.get('/contas/hash', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.json({ ok:true, hash:'0' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.json({ ok:true, hash:'0' });
    try {
      const hash = await contasRepo.computeHash(empresaId);
      res.json({ ok:true, hash });
    } catch(e) {
      logger.error('GET /api/contas/hash falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'DB error' });
    }
  });

  // ── POST /api/contas — cria conta ────────────────────────────────────────

  router.post('/contas', writeLimiter, jwtMiddleware, requireRole('gerente'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const schema = Joi.object({
      parent_codigo: Joi.string().max(50).optional().allow('', null),
      nome:          Joi.string().trim().min(1).max(200).required()
        .messages({ 'any.required':'nome obrigatório', 'string.empty':'nome obrigatório' }),
      natureza:      Joi.string().valid('entrada','saida','Entrada','Saída','saída').optional().allow('', null),
    });
    const { error: vErr, value: body } = schema.validate(req.body, { abortEarly:true, stripUnknown:true });
    if (vErr) return res.status(400).json({ ok:false, erro: vErr.details[0].message });

    const { parent_codigo, nome, natureza } = body;
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      let parentId = null, novoCodigo;

      if (parent_codigo) {
        const pai = await contasRepo.findByCodigo(empresaId, parent_codigo, conn);
        if (!pai) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Conta pai não encontrada: ' + parent_codigo }); }
        parentId   = pai.id;
        const maxSeg = await contasRepo.maxChildSegment(empresaId, parentId, conn);
        novoCodigo = pai.codigo + '.' + (maxSeg + 1);
      } else {
        const maxSeg = await contasRepo.maxRootSegment(empresaId, conn);
        novoCodigo   = String(maxSeg + 1);
      }

      const nat = natureza === 'entrada' ? 'entrada' : 'saida';
      const id  = await contasRepo.insert(conn, empresaId, parentId, novoCodigo, nome.toUpperCase().trim(), nat);
      await conn.commit();
      await audit(req, 'conta_criada', 'conta', novoCodigo, {
        codigo: novoCodigo, nome: nome.toUpperCase().trim(),
        natureza: nat, parent_codigo: parent_codigo || null,
      });
      res.json({ ok:true, id, codigo: novoCodigo });
    } catch(e) {
      await conn.rollback();
      logger.error('POST /api/contas falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  // ── PUT /api/contas/:codigo — renomeia / altera orçamento ────────────────

  router.put('/contas/:codigo', writeLimiter, jwtMiddleware, requireRole('gerente'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const codigo = req.params.codigo;
    if (!codigo?.trim()) return res.status(400).json({ ok:false, erro:'código inválido' });

    const schema = Joi.object({
      nome:      Joi.string().min(1).max(200).optional(),
      orcamento: Joi.number().min(0).optional().allow(null),
    }).or('nome','orcamento').messages({ 'object.missing':'Informe nome ou orcamento' });
    const { error: vErr, value: body } = schema.validate(req.body, { abortEarly:true, stripUnknown:true });
    if (vErr) return res.status(400).json({ ok:false, erro: vErr.details[0].message });

    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const row = await contasRepo.findByCodigo(empresaId, codigo, conn);
      if (!row) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Conta não encontrada: ' + codigo }); }

      const before = { nome: row.nome, orcamento: row.orcamento };
      const fields  = {};
      if (body.nome      !== undefined) fields.nome      = body.nome.toUpperCase().trim();
      if (body.orcamento !== undefined) fields.orcamento = body.orcamento ?? null;

      await contasRepo.updateFields(conn, row.id, empresaId, fields);
      await conn.commit();

      const after = { ...fields };
      await audit(req, 'conta_editada', 'conta', codigo, { before, after });
      res.json({ ok:true, codigo, ...(fields.nome !== undefined && { nome: fields.nome }) });
    } catch(e) {
      await conn.rollback();
      logger.error('PUT /api/contas falhou', { err: e && e.message, codigo });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  // ── DELETE /api/contas/:codigo — soft-delete (cascata) ──────────────────

  router.delete('/contas/:codigo', writeLimiter, jwtMiddleware, requireAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const codigo = req.params.codigo;

    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const conta = await contasRepo.findByCodigo(empresaId, codigo, conn);
      if (!conta) { await conn.rollback(); return res.status(404).json({ ok:false, erro:'Conta não encontrada: ' + codigo }); }

      const qtd = await contasRepo.countChildren(conn, empresaId, conta.id);
      if (qtd > 0) {
        await conn.rollback();
        return res.status(409).json({ ok:false, erro:`Conta "${conta.nome}" possui ${qtd} subconta(s) ativa(s). Remova-as primeiro.` });
      }

      await contasRepo.softDeleteLancamentos(conn, empresaId, conta.id);
      await contasRepo.softDelete(conn, conta.id, empresaId);
      await conn.commit();
      await audit(req, 'conta_deletada', 'conta', codigo, { codigo, nome: conta.nome });
      res.json({ ok:true, codigo, nome: conta.nome });
    } catch(e) {
      await conn.rollback();
      logger.error('DELETE /api/contas falhou', { err: e && e.message, codigo });
      res.status(500).json({ ok:false, erro:'DB error' });
    } finally {
      conn.release();
    }
  });

  // ── POST /api/admin/re-encrypt — re-criptografa CPF/CNPJ ────────────────

  router.post('/admin/re-encrypt', jwtMiddleware, requireAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    if (!cryptoUtils?.reEncrypt) return res.status(501).json({ ok:false, erro:'reEncrypt não disponível' });
    const { reEncrypt } = cryptoUtils;

    let updated = 0, skipped = 0, errors = 0;
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();

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
        if (Object.keys(patch).length)
          await conn.query('UPDATE fornecedor SET ? WHERE id = ? AND empresa_id = ?', [patch, f.id, empresaId]);
      }

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
        targetVersion: parseInt(process.env.ENCRYPT_KEY_VERSION || '1', 10),
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

  // ── POST /api/admin/fix-encoding — corrige mojibake ─────────────────────

  router.post('/admin/fix-encoding', jwtMiddleware, requireAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    try {
      const p = 'C[23][89AB][0-9A-Fa-f]';
      const [rC] = await db.pool.query(
        'UPDATE conta SET nome = CONVERT(BINARY CONVERT(nome USING latin1) USING utf8) WHERE empresa_id = ? AND HEX(nome) REGEXP ?',
        [empresaId, p]
      );
      const [rL] = await db.pool.query(
        'UPDATE lancamento SET descricao = CONVERT(BINARY CONVERT(descricao USING latin1) USING utf8) WHERE empresa_id = ? AND descricao IS NOT NULL AND LENGTH(descricao) > 0 AND HEX(descricao) REGEXP ?',
        [empresaId, p]
      );
      const fixedContas = rC.affectedRows || 0;
      const fixedLancs  = rL.affectedRows || 0;
      await audit(req, 'fix_encoding', 'conta', null, { fixedContas, fixedLancs });
      res.json({ ok:true, fixedContas, fixedLancs });
    } catch(e) {
      logger.error('fix_encoding falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro: e.message });
    }
  });

  return router;
};
