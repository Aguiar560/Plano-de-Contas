'use strict';

const express = require('express');

module.exports = function usersRoutes({ logger, audit, Joi, bcrypt, usersDb, readLimiter, writeLimiter, jwtMiddleware, requireAdmin, db }) {
  const router = express.Router();

  router.get('/users', jwtMiddleware, requireAdmin, async (req, res) => {
    const empresaId = req.user.empresaId;
    try {
      const users = await usersDb.listAll(empresaId);
      res.json({ ok:true, users: users.map(u=>({ id:u.id, usuario:u.usuario, nome:u.nome, perfil:u.perfil, ativo:u.ativo, lockUntil: u.lockUntil || null })) });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao listar usuários' }); }
  });

  router.post('/users', jwtMiddleware, requireAdmin, async (req, res) => {
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const schema = Joi.object({
      usuario: Joi.string().alphanum().min(3).max(50).required(),
      nome:    Joi.string().min(1).max(200).required(),
      senha:   Joi.string().min(6).max(200).required(),
      perfil:  Joi.string().valid('admin','gerente','operador','visualizador').required()
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro:'Dados inválidos' });
    const { usuario, nome, senha, perfil } = value;
    try {
      const exists = await usersDb.findByUsuario(usuario, empresaId);
      if (exists) return res.status(400).json({ ok:false, erro:'Usuário já existe nesta empresa' });
      const hash = bcrypt.hashSync(senha, 10);
      const id = await usersDb.createUser({ usuario: usuario.toLowerCase().trim(), nome: nome.trim(), senhaHash: hash, perfil, empresaId });
      await audit(req, 'create_user', 'usuario', id, { usuario: usuario.toLowerCase().trim(), nome: nome.trim(), perfil });
      res.json({ ok:true, user: { id, usuario: usuario.toLowerCase().trim(), nome: nome.trim(), perfil } });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao criar usuário' }); }
  });

  router.put('/users/:id', jwtMiddleware, requireAdmin, async (req, res) => {
    const empresaId = req.user.empresaId;
    const id = +req.params.id;
    const { perfil, ativo } = req.body;
    try {
      const u = await usersDb.findById(id);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      // Admin só pode editar usuários da própria empresa
      if (empresaId && u.empresaId !== empresaId) return res.status(403).json({ ok:false, erro:'Forbidden' });
      if (u.perfil==='admin' && ativo===false) {
        const all = await usersDb.listAll(empresaId);
        const admins = all.filter(x=>x.perfil==='admin' && x.ativo);
        if (admins.length<=1) return res.status(400).json({ ok:false, erro:'Não é possível desativar o único admin' });
      }
      await usersDb.updateUser(id, { perfil: perfil || u.perfil, ativo: typeof ativo === 'boolean' ? ativo : u.ativo }, empresaId);
      await audit(req, 'update_user', 'usuario', id, { before: { perfil: u.perfil, ativo: u.ativo }, after: { perfil: perfil || u.perfil, ativo: typeof ativo === 'boolean' ? ativo : u.ativo } });
      res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao atualizar usuário' }); }
  });

  router.post('/users/:id/reset-password', jwtMiddleware, requireAdmin, async (req, res) => {
    const empresaId = req.user.empresaId;
    const schema = Joi.object({ nova: Joi.string().min(6).max(200).required() });
    const { error, value } = schema.validate(req.body);
    const id = +req.params.id;
    if (error) return res.status(400).json({ ok:false, erro:'Nova senha requerida' });
    try {
      const u = await usersDb.findById(id);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      if (empresaId && u.empresaId !== empresaId) return res.status(403).json({ ok:false, erro:'Forbidden' });
      await usersDb.updatePassword(id, bcrypt.hashSync(value.nova, 10));
      await audit(req, 'reset_password', 'usuario', id, { targetUsuario: u.usuario });
      res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao redefinir senha' }); }
  });

  router.post('/me/first-password', writeLimiter, jwtMiddleware, async (req, res) => {
    const { nova } = req.body;
    if (!nova || nova.length < 4) return res.status(400).json({ ok:false, erro:'Senha muito curta (mínimo 4 caracteres)' });
    try {
      const u = await usersDb.findById(req.user.userId);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      const hash = bcrypt.hashSync(nova, 10);
      await usersDb.updatePassword(u.id, hash);
      if (db) await db.execute('UPDATE usuario SET must_change_password = 0 WHERE id = ?', [u.id]);
      await audit(req, 'first_password_set', 'usuario', u.id, { usuario: u.usuario });
      return res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao definir senha' }); }
  });

  router.post('/me/change-password', writeLimiter, jwtMiddleware, async (req, res) => {
    const { atual, nova } = req.body;
    if (!atual || !nova) return res.status(400).json({ ok:false, erro:'Campos obrigatórios' });
    try {
      const u = await usersDb.findById(req.user.userId);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      if (!bcrypt.compareSync(atual, u.senhaHash)) return res.status(400).json({ ok:false, erro:'Senha atual incorreta' });
      await usersDb.updatePassword(u.id, bcrypt.hashSync(nova, 10));
      await audit(req, 'change_password', 'usuario', u.id, { usuario: u.usuario });
      return res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao alterar senha' }); }
  });

  router.post('/users/:id/unlock', jwtMiddleware, requireAdmin, async (req, res) => {
    const empresaId = req.user.empresaId;
    const id = +req.params.id;
    try {
      const u = await usersDb.findById(id);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      if (empresaId && u.empresaId !== empresaId) return res.status(403).json({ ok:false, erro:'Forbidden' });
      await usersDb.unlockUser(id);
      await audit(req, 'unlock_user', 'usuario', id, { targetUsuario: u.usuario });
      res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao desbloquear usuário' }); }
  });

  router.delete('/users/:id', jwtMiddleware, requireAdmin, async (req, res) => {
    const empresaId = req.user.empresaId;
    const id = +req.params.id;
    try {
      const u = await usersDb.findById(id);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      if (empresaId && u.empresaId !== empresaId) return res.status(403).json({ ok:false, erro:'Forbidden' });
      if (u.perfil === 'admin') {
        const all = await usersDb.listAll(empresaId);
        const admins = all.filter(x=>x.perfil==='admin' && x.ativo);
        if (admins.length <= 1) return res.status(400).json({ ok:false, erro:'Não é possível remover o último administrador.' });
      }
      await usersDb.deleteUser(id, empresaId);
      await audit(req, 'remove_user', 'usuario', id, { usuario: u.usuario, perfil: u.perfil });
      res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao remover usuário' }); }
  });

  router.get('/users/:id/permissions', jwtMiddleware, requireAdmin, async (req, res) => {
    const id = +req.params.id;
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    try {
      const perms = await usersDb.getUserPermissions(id);
      res.json({ ok:true, permissions: perms || {} });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao ler permissões' }); }
  });

  router.put('/users/:id/permissions', jwtMiddleware, requireAdmin, async (req, res) => {
    const id = +req.params.id;
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    const schema = Joi.object().pattern(Joi.string(), Joi.boolean()).required();
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro:'Payload inválido — esperado { acao: boolean }' });
    try {
      const u = await usersDb.findById(id);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      await usersDb.saveUserPermissions(id, value);
      await audit(req, 'update_permissions', 'usuario', id, { targetUsuario: u.usuario, permissions: value });
      res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao salvar permissões' }); }
  });

  router.get('/audit', readLimiter, jwtMiddleware, requireAdmin, async (req, res) => {
    const empresaId = req.user.empresaId;
    const qSchema = Joi.object({
      action:      Joi.string().max(100).optional().allow(''),
      entityType:  Joi.string().valid('conta','lancamento','usuario').optional().allow(''),
      entityId:    Joi.string().max(100).optional().allow(''),
      actorUserId: Joi.number().integer().positive().optional(),
      dtI:         Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(''),
      dtF:         Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(''),
      page:        Joi.number().integer().min(1).default(1),
      limit:       Joi.number().integer().min(1).max(500).default(100)
    });
    const { error: vErr, value: q } = qSchema.validate(req.query, { abortEarly: true, stripUnknown: true });
    if (vErr) return res.status(400).json({ ok:false, erro: vErr.details[0].message });
    try {
      const result = await usersDb.getAuditEntries({
        action:      q.action      || undefined,
        entityType:  q.entityType  || undefined,
        entityId:    q.entityId    || undefined,
        actorUserId: q.actorUserId || undefined,
        dtI:         q.dtI         || undefined,
        dtF:         q.dtF         || undefined,
        empresaId:   empresaId     || undefined,
        page:  q.page,
        limit: q.limit
      });
      res.json({ ok:true, ...result });
    } catch(e){ console.error(e); res.status(500).json({ ok:false, erro:'Erro ao ler audit' }); }
  });

  // ── LGPD Art. 18-20: exportação e exclusão de dados pessoais ─────────────

  router.get('/me/data-export', readLimiter, jwtMiddleware, async (req, res) => {
    const id = req.user.userId;
    try {
      const u = await usersDb.findById(id);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      let auditEntries = [];
      if (db) {
        const [rows] = await db.pool.query(
          'SELECT action, entity_type, entity_id, `when` FROM audit_log WHERE actor_user_id = ? ORDER BY `when` DESC LIMIT 500',
          [id]
        );
        auditEntries = rows;
      }
      await audit(req, 'data_export', 'usuario', id, { usuario: u.usuario });
      res.json({
        ok: true,
        exportadoEm: new Date().toISOString(),
        usuario: { id: u.id, usuario: u.usuario, nome: u.nome, perfil: u.perfil, criadoEm: u.createdAt || null },
        historico: auditEntries,
      });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao exportar dados' }); }
  });

  router.delete('/me', writeLimiter, jwtMiddleware, async (req, res) => {
    const empresaId = req.user.empresaId;
    const { senha } = req.body || {};
    if (!senha) return res.status(400).json({ ok:false, erro:'Confirme com sua senha para excluir a conta.' });
    try {
      const u = await usersDb.findById(req.user.userId);
      if (!u) return res.status(404).json({ ok:false, erro:'Usuário não encontrado' });
      if (u.perfil === 'admin') {
        const all = await usersDb.listAll(empresaId);
        if (all.filter(x => x.perfil === 'admin' && x.ativo).length <= 1) {
          return res.status(400).json({ ok:false, erro:'Não é possível excluir o único administrador.' });
        }
      }
      if (!bcrypt.compareSync(senha, u.senhaHash)) {
        return res.status(400).json({ ok:false, erro:'Senha incorreta.' });
      }
      if (db) {
        await db.pool.query('UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id = ?', [u.id]);
      }
      await usersDb.deleteUser(u.id, empresaId);
      await audit(req, 'self_delete', 'usuario', u.id, { usuario: u.usuario });
      res.clearCookie('auth_token');
      res.clearCookie('refresh_token');
      res.json({ ok:true, mensagem: 'Conta removida com sucesso.' });
    } catch(e) { res.status(500).json({ ok:false, erro:'Erro ao excluir conta' }); }
  });

  return router;
};
