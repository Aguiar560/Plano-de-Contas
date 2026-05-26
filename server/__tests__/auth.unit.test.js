/**
 * auth.unit.test.js — Testes unitários para lógica de autenticação
 *
 * Cobre sem fazer chamadas HTTP:
 *  - Geração e verificação de JWT
 *  - Token expirado é rejeitado
 *  - Token com secret errado é rejeitado
 *  - bcrypt: hash e verificação de senha
 *  - jwtMiddleware via supertest (sem DB)
 */

'use strict';

const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const { app, makeToken, makeExpiredToken, JWT_SECRET } = require('./helpers');

// ── JWT ────────────────────────────────────────────────────────────────────

describe('JWT — geração e verificação', () => {
  test('token gerado com payload correto é verificável', () => {
    const token = makeToken({ userId: 42, usuario: 'joao', perfil: 'operador' });
    const decoded = jwt.verify(token, JWT_SECRET);
    expect(decoded.userId).toBe(42);
    expect(decoded.usuario).toBe('joao');
    expect(decoded.perfil).toBe('operador');
  });

  test('token expirado lança JsonWebTokenError', () => {
    const expired = makeExpiredToken();
    expect(() => jwt.verify(expired, JWT_SECRET)).toThrow();
  });

  test('token com secret diferente é rejeitado', () => {
    const token = jwt.sign({ userId: 1 }, 'outro-secret', { expiresIn: '1h' });
    expect(() => jwt.verify(token, JWT_SECRET)).toThrow();
  });

  test('token mal-formado é rejeitado', () => {
    expect(() => jwt.verify('token.invalido.aqui', JWT_SECRET)).toThrow();
  });

  test('payload mantém perfil admin', () => {
    const token = makeToken({ perfil: 'admin' });
    const decoded = jwt.verify(token, JWT_SECRET);
    expect(decoded.perfil).toBe('admin');
  });
});

// ── bcrypt ─────────────────────────────────────────────────────────────────

describe('bcrypt — hash e verificação de senhas', () => {
  const senha = 'MinhaSenh@123';
  let hash;

  beforeAll(() => {
    hash = bcrypt.hashSync(senha, 10);
  });

  test('hash gerado não é igual à senha original', () => {
    expect(hash).not.toBe(senha);
  });

  test('senha correta passa na verificação', () => {
    expect(bcrypt.compareSync(senha, hash)).toBe(true);
  });

  test('senha errada falha na verificação', () => {
    expect(bcrypt.compareSync('senhaErrada', hash)).toBe(false);
  });

  test('string vazia não passa na verificação', () => {
    expect(bcrypt.compareSync('', hash)).toBe(false);
  });

  test('dois hashes da mesma senha são diferentes (salt aleatório)', () => {
    const h2 = bcrypt.hashSync(senha, 10);
    expect(hash).not.toBe(h2);
    // mas ambos verificam corretamente
    expect(bcrypt.compareSync(senha, h2)).toBe(true);
  });
});

// ── jwtMiddleware via HTTP ─────────────────────────────────────────────────

describe('jwtMiddleware — proteção de rotas', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('token expirado retorna 401', async () => {
    const expired = makeExpiredToken();
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer ' + expired);
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('token malformado retorna 401', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer nao.e.um.token');
    expect(res.status).toBe(401);
  });

  test('token de não-admin retorna 403 em rota admin', async () => {
    const token = makeToken({ perfil: 'operador' });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  test('token admin válido retorna 200 em GET /api/users', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  test('token via cookie auth_token é aceito', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .get('/api/users')
      .set('Cookie', 'auth_token=' + token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── bodyParser limite ──────────────────────────────────────────────────────

describe('bodyParser — limite de payload', () => {
  test('payload acima de 100kb retorna 413', async () => {
    const token = makeToken({ perfil: 'admin' });
    const huge = { nome: 'X'.repeat(200 * 1024) }; // 200 KB
    const res = await request(app)
      .post('/api/contas')
      .set('Authorization', 'Bearer ' + token)
      .send(huge);
    expect(res.status).toBe(413);
  });
});
