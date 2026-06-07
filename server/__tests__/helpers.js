/**
 * helpers.js — Utilitários compartilhados entre os testes
 *
 * - getAdminToken(): faz login como admin e retorna o Bearer token
 * - ADMIN / TEST_USER: credenciais usadas nos testes
 */

'use strict';

const request = require('supertest');
const jwt     = require('jsonwebtoken');

// Silenciar logs do servidor durante os testes
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

const app = require('../server');

// Garantir que todas as migrações de schema terminaram antes de qualquer teste
beforeAll(() => app.migrationsReady);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const ADMIN = { usuario: 'admin', senha: 'admin' };

/**
 * Faz POST /api/login e retorna um Bearer token JWT para uso nos testes.
 * O token não é mais devolvido no body (apenas no cookie httpOnly),
 * então geramos um via makeToken() após confirmar que o login foi aceito.
 * Lança erro se o login falhar.
 */
async function getAdminToken() {
  const res = await request(app)
    .post('/api/login')
    .send(ADMIN);
  if (!res.body.ok) throw new Error('getAdminToken: login falhou — ' + JSON.stringify(res.body));
  const u = res.body.user;
  return makeToken({ userId: u.id, usuario: u.usuario, perfil: u.perfil });
}

/**
 * Gera um token JWT válido diretamente (sem fazer HTTP — útil para testes unitários de middleware).
 */
function makeToken(payload = {}, opts = {}) {
  return jwt.sign(
    { userId: 1, usuario: 'admin', perfil: 'admin', empresaId: 1, ...payload },
    JWT_SECRET,
    { expiresIn: '1h', ...opts }
  );
}

/**
 * Gera um token já expirado (para testar rejeição).
 */
function makeExpiredToken() {
  return jwt.sign(
    { userId: 1, usuario: 'admin', perfil: 'admin' },
    JWT_SECRET,
    { expiresIn: '-1s' }
  );
}

module.exports = { app, getAdminToken, makeToken, makeExpiredToken, JWT_SECRET, ADMIN };
