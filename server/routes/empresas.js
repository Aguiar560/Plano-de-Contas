'use strict';

const express = require('express');

// Rotas de gestão de tenants.
// - Superadmin (empresa_id = NULL, perfil = 'superadmin') → acesso total
// - Admin (empresa_id = X) → apenas GET /empresas/me e PUT /empresas/me

module.exports = function empresasRoutes({ db, logger, audit, Joi, readLimiter, writeLimiter, jwtMiddleware, requireSuperAdmin, bcrypt, usersDb }) {
  const router = express.Router();

  const _empresaSchema = Joi.object({
    nome:  Joi.string().min(1).max(200).required(),
    slug:  Joi.string().alphanum().min(2).max(100).lowercase().required(),
    plano: Joi.string().valid('basico','profissional','enterprise').default('basico'),
    ativo: Joi.boolean().default(true),
    dados: Joi.object().optional().allow(null)
  });

  // ── GET /empresas — lista todos (superadmin) ──────────────────────────────
  router.get('/empresas', readLimiter, jwtMiddleware, requireSuperAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    try {
      const rows = await db.query('SELECT id, nome, slug, plano, ativo, created_at FROM empresa ORDER BY nome');
      res.json({ ok:true, empresas: rows });
    } catch(e) {
      logger.error('GET /api/empresas falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao listar empresas' });
    }
  });

  // ── GET /empresas/me — dados da empresa do usuário logado ─────────────────
  router.get('/empresas/me', readLimiter, jwtMiddleware, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    try {
      const [empresa] = await db.query('SELECT id, nome, slug, plano, ativo, created_at FROM empresa WHERE id = ? LIMIT 1', [empresaId]);
      if (!empresa) return res.status(404).json({ ok:false, erro:'Empresa não encontrada' });
      res.json({ ok:true, empresa });
    } catch(e) {
      logger.error('GET /api/empresas/me falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao buscar empresa' });
    }
  });

  // ── POST /empresas — criar novo tenant (superadmin) ───────────────────────
  router.post('/empresas', writeLimiter, jwtMiddleware, requireSuperAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const schemaFull = _empresaSchema.keys({
      admin_usuario: Joi.string().alphanum().min(3).max(50).required(),
      admin_senha:   Joi.string().min(6).max(200).required(),
      admin_nome:    Joi.string().min(1).max(200).default('Administrador')
    });
    const { error, value } = schemaFull.validate(req.body, { abortEarly: true, stripUnknown: true });
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });

    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Verifica slug único
      const [[{ cnt }]] = await conn.query('SELECT COUNT(1) AS cnt FROM empresa WHERE slug = ?', [value.slug]);
      if (cnt > 0) { await conn.rollback(); return res.status(400).json({ ok:false, erro:'Slug já utilizado' }); }

      const [ins] = await conn.query(
        'INSERT INTO empresa (nome, slug, plano, ativo, dados, created_at, updated_at) VALUES (?,?,?,?,?,NOW(),NOW())',
        [value.nome, value.slug, value.plano, value.ativo ? 1 : 0, value.dados ? JSON.stringify(value.dados) : null]
      );
      const novaEmpresaId = ins.insertId;

      // Cria admin inicial para a nova empresa
      const hash = bcrypt.hashSync(value.admin_senha, 10);
      await conn.query(
        'INSERT INTO usuario (empresa_id, usuario, nome, senha_hash, perfil, ativo, created_at) VALUES (?,?,?,?,?,1,NOW())',
        [novaEmpresaId, value.admin_usuario.toLowerCase().trim(), value.admin_nome.trim(), hash, 'admin']
      );

      await conn.commit();
      await audit(req, 'empresa_criada', 'empresa', novaEmpresaId, { nome: value.nome, slug: value.slug });
      res.json({ ok:true, id: novaEmpresaId, slug: value.slug });
    } catch(e) {
      await conn.rollback();
      logger.error('POST /api/empresas falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao criar empresa' });
    } finally {
      conn.release();
    }
  });

  // ── PUT /empresas/:id — editar tenant (superadmin) ────────────────────────
  router.put('/empresas/:id', writeLimiter, jwtMiddleware, requireSuperAdmin, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    const { error, value } = _empresaSchema.validate(req.body, { abortEarly: true, stripUnknown: true });
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      const [r] = await db.pool.query(
        'UPDATE empresa SET nome=?, slug=?, plano=?, ativo=?, updated_at=NOW() WHERE id=?',
        [value.nome, value.slug, value.plano, value.ativo ? 1 : 0, id]
      );
      if (r.affectedRows === 0) return res.status(404).json({ ok:false, erro:'Empresa não encontrada' });
      await audit(req, 'empresa_editada', 'empresa', id, { nome: value.nome, slug: value.slug });
      res.json({ ok:true });
    } catch(e) {
      logger.error('PUT /api/empresas falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao atualizar empresa' });
    }
  });

  // ── PUT /empresas/me — admin da empresa edita dados próprios ─────────────
  router.put('/empresas/me', writeLimiter, jwtMiddleware, async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    if (req.user.perfil !== 'admin') return res.status(403).json({ ok:false, erro:'Apenas admin pode editar a empresa' });
    const schema = Joi.object({ nome: Joi.string().min(1).max(200).required() });
    const { error, value } = schema.validate(req.body, { abortEarly: true, stripUnknown: true });
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      await db.pool.query('UPDATE empresa SET nome=?, updated_at=NOW() WHERE id=?', [value.nome, empresaId]);
      res.json({ ok:true });
    } catch(e) {
      logger.error('PUT /api/empresas/me falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao atualizar empresa' });
    }
  });

  return router;
};
