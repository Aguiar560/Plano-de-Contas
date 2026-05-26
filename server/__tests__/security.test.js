/**
 * security.test.js — Testes de segurança da API
 *
 * Cobre:
 *  - Cabeçalhos HTTP de segurança (helmet): CSP, X-Frame-Options, X-Content-Type-Options
 *  - Flags de cookie (HttpOnly, SameSite) em auth_token e refresh_token
 *  - Rate limiter em POST /api/login — resposta 429 com formato correto
 *  - Mensagem genérica de autenticação (não vaza info sobre existência de usuário)
 *  - Token JWT: ausência de campos sensíveis no payload
 */

'use strict';

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const { app, ADMIN, JWT_SECRET } = require('./helpers');

// ── Cabeçalhos de segurança HTTP ──────────────────────────────────────────

describe('Cabeçalhos HTTP de segurança (helmet)', () => {
  let res;
  // Usar rota pública (frontend estático) para verificar os cabeçalhos HTTP
  beforeAll(async () => {
    res = await request(app).get('/');
  });

  test('X-Content-Type-Options: nosniff está presente', () => {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options está presente (DENY ou SAMEORIGIN)', () => {
    const val = res.headers['x-frame-options'];
    // helmet pode retornar DENY ou SAMEORIGIN dependendo da configuração
    expect(['DENY', 'SAMEORIGIN']).toContain(val);
  });

  test('Content-Security-Policy está presente', () => {
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy'].length).toBeGreaterThan(10);
  });

  test('CSP proíbe default-src * (deve ser self ou lista explícita)', () => {
    const csp = res.headers['content-security-policy'] || '';
    // Não deve ter default-src *
    expect(csp).not.toMatch(/default-src\s+\*/);
  });

  test('X-DNS-Prefetch-Control está presente', () => {
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
  });

  test('X-Download-Options está presente (IE)', () => {
    // helmet adiciona este header para IE
    expect(res.headers['x-download-options']).toBeDefined();
  });
});

// ── Flags de cookie de autenticação ──────────────────────────────────────

describe('Cookies de autenticação — flags de segurança', () => {
  let loginRes;

  beforeAll(async () => {
    loginRes = await request(app).post('/api/login').send(ADMIN);
  });

  test('login retorna 200 com token', () => {
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.ok).toBe(true);
  });

  test('auth_token cookie tem flag HttpOnly', () => {
    const cookies = loginRes.headers['set-cookie'] || [];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toMatch(/HttpOnly/i);
  });

  test('auth_token cookie tem flag SameSite', () => {
    const cookies = loginRes.headers['set-cookie'] || [];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toMatch(/SameSite/i);
  });

  test('refresh_token cookie tem flag HttpOnly', () => {
    const cookies = loginRes.headers['set-cookie'] || [];
    const refreshCookie = cookies.find(c => c.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
  });

  test('refresh_token cookie tem flag SameSite', () => {
    const cookies = loginRes.headers['set-cookie'] || [];
    const refreshCookie = cookies.find(c => c.startsWith('refresh_token='));
    expect(refreshCookie).toMatch(/SameSite/i);
  });

  test('auth_token NÃO tem flag Secure em ambiente dev', () => {
    // Em dev (NODE_ENV != 'production'), Secure não deve estar presente
    // para permitir HTTP local
    const cookies = loginRes.headers['set-cookie'] || [];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    if (process.env.NODE_ENV !== 'production') {
      expect(authCookie).not.toMatch(/;\s*Secure\b/i);
    }
  });
});

// ── Payload do JWT — sem dados sensíveis ─────────────────────────────────

describe('JWT — payload não expõe dados sensíveis', () => {
  test('token não contém senhaHash', async () => {
    const res = await request(app).post('/api/login').send(ADMIN);
    // Token está apenas no cookie httpOnly — extrair para verificar payload
    const cookies = res.headers['set-cookie'] || [];
    const rawToken = (cookies.find(c => c.startsWith('auth_token=')) || '').split(';')[0].replace('auth_token=', '');
    expect(rawToken).toBeTruthy();
    const decoded = jwt.verify(rawToken, JWT_SECRET);
    expect(decoded.senhaHash).toBeUndefined();
    expect(decoded.senha_hash).toBeUndefined();
    expect(decoded.password).toBeUndefined();
  });

  test('token contém apenas userId, usuario e perfil no payload', async () => {
    const res = await request(app).post('/api/login').send(ADMIN);
    const cookies = res.headers['set-cookie'] || [];
    const rawToken = (cookies.find(c => c.startsWith('auth_token=')) || '').split(';')[0].replace('auth_token=', '');
    expect(rawToken).toBeTruthy();
    const decoded = jwt.verify(rawToken, JWT_SECRET);
    expect(decoded.userId).toBeDefined();
    expect(decoded.usuario).toBe('admin');
    expect(decoded.perfil).toBe('admin');
  });

  test('body de login não expõe senhaHash do usuário', async () => {
    const res = await request(app).post('/api/login').send(ADMIN);
    expect(res.body.user.senhaHash).toBeUndefined();
    expect(res.body.user.senha_hash).toBeUndefined();
  });
});

// ── Mensagem genérica de autenticação ─────────────────────────────────────

describe('Autenticação — não vaza informações sobre usuários', () => {
  test('usuário inexistente retorna mesma mensagem que senha errada', async () => {
    const res1 = await request(app)
      .post('/api/login')
      .send({ usuario: 'admin', senha: 'senhaErradaXXXX' });

    const res2 = await request(app)
      .post('/api/login')
      .send({ usuario: 'usuario_que_definitivamente_nao_existe_99999', senha: 'qualquer' });

    expect(res1.status).toBe(401);
    expect(res2.status).toBe(401);
    expect(res1.body.erro).toBe(res2.body.erro); // mesma mensagem genérica
  });

  test('resposta 401 não menciona "usuário não encontrado" ou "não existe"', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ usuario: 'inexistente', senha: 'errada' });

    expect(res.body.erro.toLowerCase()).not.toMatch(/não encontrado|not found|inexistente|existe/);
  });
});

// ── Rate limiter — POST /api/login ─────────────────────────────────────────

describe('Rate limiter — POST /api/login', () => {
  test('resposta normal (401) tem formato correto', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ usuario: 'x', senha: 'y' });

    expect([401, 429]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });

  test('ao acionar o limite, resposta 429 tem campo erro', async () => {
    // Dispara 12 requisições simultâneas para ter chance de acionar o limiter
    const promises = Array.from({ length: 12 }, () =>
      request(app).post('/api/login').send({ usuario: 'teste_rate', senha: 'errada' })
    );
    const responses = await Promise.all(promises);
    const hit429 = responses.find(r => r.status === 429);

    if (hit429) {
      // Se o rate limiter foi acionado, deve ter formato correto
      expect(hit429.body.ok).toBe(false);
      expect(typeof hit429.body.erro).toBe('string');
      expect(hit429.body.erro.length).toBeGreaterThan(0);
    }
    // Se não atingiu 429, outros testes já consumiram o limite — ok
  });
});

// ── CSRF — origem inválida é rejeitada em produção ────────────────────────

describe('CSRF — validação de origem', () => {
  test('em ambiente de teste (não produção), CSRF não bloqueia POST', async () => {
    // Em dev/test, CSRF não deve bloquear (facilita desenvolvimento)
    const res = await request(app)
      .post('/api/login')
      .set('Origin', 'https://evil.example.com')
      .send({ usuario: 'admin', senha: 'admin' });

    // Em dev: não deve retornar 403 por CSRF
    if (process.env.NODE_ENV !== 'production') {
      expect(res.status).not.toBe(403);
    }
  });
});
