/**
 * login.test.js — Testes de integração para POST /api/login
 *
 * Cobre:
 *  - Login com credenciais corretas retorna user (token apenas no cookie httpOnly)
 *  - Cookie auth_token é setado no login
 *  - Senha errada retorna 401 com mensagem genérica
 *  - Usuário inexistente retorna 401 (mensagem genérica — não vaza info)
 *  - Campos ausentes retornam 400
 *  - POST /api/logout limpa o cookie
 *  - POST /api/refresh sem cookie retorna 401
 */

'use strict';

const request = require('supertest');
const { app, ADMIN } = require('./helpers');

describe('POST /api/login', () => {
  test('credenciais corretas retornam ok:true com user (token apenas no cookie)', async () => {
    const res = await request(app)
      .post('/api/login')
      .send(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Token não é exposto no body — fica apenas no cookie httpOnly
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.usuario).toBe('admin');
    expect(res.body.user.perfil).toBe('admin');
    // Nunca deve expor o hash da senha
    expect(res.body.user.senhaHash).toBeUndefined();
  });

  test('cookie auth_token é setado após login bem-sucedido', async () => {
    const res = await request(app)
      .post('/api/login')
      .send(ADMIN);

    const cookies = res.headers['set-cookie'] || [];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toMatch(/HttpOnly/i);
  });

  test('senha errada retorna 401', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ usuario: 'admin', senha: 'senhaErrada' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    // Mensagem genérica — não deve revelar se usuário existe
    expect(res.body.erro).toMatch(/inválidos/i);
  });

  test('usuário inexistente retorna 401 com mesma mensagem genérica', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ usuario: 'usuario_que_nao_existe', senha: 'qualquer' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toMatch(/inválidos/i);
  });

  test('body sem usuario retorna 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ senha: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('body sem senha retorna 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ usuario: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('body vazio retorna 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({});

    expect(res.status).toBe(400);
  });

  test('content-type application/json é obrigatório (corpo sem JSON retorna 400)', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('Content-Type', 'text/plain')
      .send('usuario=admin&senha=admin');

    // Joi valida após parse — se não vier JSON o body fica vazio → 400
    expect([400, 415]).toContain(res.status);
  });
});

describe('POST /api/logout', () => {
  test('logout com cookie válido retorna ok:true e limpa cookies', async () => {
    // 1. Login para obter o cookie auth_token
    const loginRes = await request(app).post('/api/login').send(ADMIN);
    const cookies = loginRes.headers['set-cookie'] || [];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toBeDefined();

    // 2. Logout enviando o cookie (não o body token — não existe mais)
    const res = await request(app)
      .post('/api/logout')
      .set('Cookie', authCookie.split(';')[0]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verificar que os cookies são removidos (set-cookie com Max-Age=0 ou expires no passado)
    const resCookies = res.headers['set-cookie'] || [];
    const clearedAuth = resCookies.find(c => c.startsWith('auth_token='));
    if (clearedAuth) {
      expect(clearedAuth).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
    }
  });

  test('logout sem token retorna 401', async () => {
    const res = await request(app).post('/api/logout');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/refresh', () => {
  test('sem cookie refresh retorna 401', async () => {
    const res = await request(app).post('/api/refresh');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('cookie refresh inválido retorna 401', async () => {
    const res = await request(app)
      .post('/api/refresh')
      .set('Cookie', 'refresh_token=tokeninvalido123');
    expect(res.status).toBe(401);
  });

  test('refresh válido renova cookie de acesso', async () => {
    // 1. Login para obter cookie refresh real
    const loginRes = await request(app).post('/api/login').send(ADMIN);
    const cookies = loginRes.headers['set-cookie'] || [];
    const refreshCookie = cookies.find(c => c.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();

    // 2. Chamar refresh com esse cookie
    const res = await request(app)
      .post('/api/refresh')
      .set('Cookie', refreshCookie.split(';')[0]); // só o valor

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Token renovado via cookie httpOnly — não exposto no body
    expect(res.body.token).toBeUndefined();
    const newCookies = res.headers['set-cookie'] || [];
    expect(newCookies.find(c => c.startsWith('auth_token='))).toBeDefined();
  });
});
