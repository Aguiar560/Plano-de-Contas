'use strict';

const express = require('express');

module.exports = function authRoutes({ db, logger, audit, Joi, bcrypt, jwt, usersDb, JWT_SECRET, JWT_EXP, COOKIE_SECURE, authLimiter, refreshLimiter, jwtMiddleware }) {
  const router = express.Router();

  router.post('/login', authLimiter, async (req, res) => {
    const schema = Joi.object({ usuario: Joi.string().min(1).max(100).required(), senha: Joi.string().min(1).max(200).required() });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: 'Preencha usuário e senha.' });
    const { usuario, senha } = value;
    const user = await usersDb.findByUsuario(usuario);
    const GENERIC = { status:401, body:{ ok:false, erro:'Usuário ou senha inválidos.' } };
    if (!user || !user.ativo) return res.status(GENERIC.status).json(GENERIC.body);

    if (user.lockUntil && Date.now() < user.lockUntil) {
      return res.status(GENERIC.status).json(GENERIC.body);
    }

    const ok = bcrypt.compareSync(senha, user.senhaHash);
    if (!ok) {
      await usersDb.recordLoginFailure(user.id);
      await audit(req, 'failed_login', 'usuario', user.id, { usuario: user.usuario });
      return res.status(GENERIC.status).json(GENERIC.body);
    }

    await usersDb.clearLoginFailures(user.id);
    const token = jwt.sign({ userId: user.id, usuario: user.usuario, perfil: user.perfil }, JWT_SECRET, { expiresIn: JWT_EXP });
    await audit(req, 'login', 'usuario', user.id, { usuario: user.usuario, perfil: user.perfil });
    const accessCookieOpts = { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 };
    if (COOKIE_SECURE) accessCookieOpts.secure = true;
    res.cookie('auth_token', token, accessCookieOpts);
    try { await usersDb.issueRefreshToken(res, user.id, COOKIE_SECURE); } catch (e) { logger.error('issueRefreshToken falhou', { userId: user.id, err: e && e.message }); }
    return res.json({ ok:true, user: { id: user.id, usuario: user.usuario, nome: user.nome, perfil: user.perfil } });
  });

  router.post('/logout', jwtMiddleware, async (req, res) => {
    const token = req.cookies && req.cookies.refresh_token;
    await usersDb.deleteRefreshToken(res, token);
    res.clearCookie('auth_token');
    return res.json({ ok:true });
  });

  router.post('/refresh', refreshLimiter, async (req, res) => {
    const token = req.cookies && req.cookies.refresh_token;
    if (!token) return res.status(401).json({ ok:false, erro:'No refresh' });
    try {
      const info = await usersDb.findRefreshToken(token);
      if (!info) { res.clearCookie('refresh_token'); return res.status(401).json({ ok:false, erro:'Invalid refresh' }); }
      const user = await usersDb.findById(info.userId);
      if (!user || !user.ativo) { res.clearCookie('refresh_token'); return res.status(401).json({ ok:false, erro:'Invalid user' }); }
      await usersDb.rotateRefreshToken(res, token, user.id, COOKIE_SECURE);
      const access = jwt.sign({ userId: user.id, usuario: user.usuario, perfil: user.perfil }, JWT_SECRET, { expiresIn: JWT_EXP });
      const accessCookieOpts = { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 };
      if (COOKIE_SECURE) accessCookieOpts.secure = true;
      res.cookie('auth_token', access, accessCookieOpts);
      await audit(req, 'token_renovado', 'usuario', user.id, { usuario: user.usuario });
      return res.json({ ok:true });
    } catch(e) { logger.error('Erro no refresh de token', { err: e && e.message }); return res.status(500).json({ ok:false, erro:'Erro interno' }); }
  });

  return router;
};
