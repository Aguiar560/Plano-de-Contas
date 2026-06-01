'use strict';

/**
 * lgpd.test.js — Testes dos direitos LGPD (Arts. 18-20)
 *
 *  - GET /api/me/data-export — exporta dados pessoais do usuário logado
 *  - DELETE /api/me         — exclui própria conta (confirma com senha)
 */

const request = require('supertest');
const { app, getAdminToken, makeToken, ADMIN } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// ── GET /api/me/data-export ───────────────────────────────────────────────

describe('GET /api/me/data-export', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/me/data-export');
    expect(res.status).toBe(401);
  });

  dbTest('usuário logado recebe seus dados pessoais', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .get('/api/me/data-export')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.usuario).toBeDefined();
    expect(res.body.usuario.usuario).toBe(ADMIN.usuario);
    // Nunca expõe a senha
    expect(res.body.usuario.senhaHash).toBeUndefined();
    expect(res.body.usuario.senha).toBeUndefined();
  });

  dbTest('resposta inclui campo exportadoEm (ISO 8601)', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .get('/api/me/data-export')
      .set('Authorization', 'Bearer ' + token);
    expect(res.body.exportadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  dbTest('resposta inclui histórico de ações do usuário', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .get('/api/me/data-export')
      .set('Authorization', 'Bearer ' + token);
    expect(Array.isArray(res.body.historico)).toBe(true);
  });
});

// ── DELETE /api/me ────────────────────────────────────────────────────────

describe('DELETE /api/me', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).delete('/api/me');
    expect(res.status).toBe(401);
  });

  test('sem confirmar com senha retorna 400', async () => {
    const token = makeToken({ perfil: 'operador', userId: 99999 });
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer ' + token)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  dbTest('senha incorreta retorna 400', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer ' + token)
      .send({ senha: 'senha_totalmente_errada' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  dbTest('único admin não pode se excluir', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer ' + token)
      .send({ senha: ADMIN.senha });
    // Deve recusar porque é o único admin
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toMatch(/administrador/i);
  });

  dbTest('usuário não-admin pode se excluir com senha correta', async () => {
    const SENHA = 'deleteme123';
    const USUARIO = 'selfdel' + Date.now().toString().slice(-6);
    const adminTok = await getAdminToken();

    // Cria usuário de teste
    const create = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + adminTok)
      .send({ usuario: USUARIO, nome: 'Self Delete Test', senha: SENHA, perfil: 'visualizador' });
    expect(create.status).toBe(200);

    // Faz login como esse usuário
    const login = await request(app)
      .post('/api/login')
      .send({ usuario: USUARIO, senha: SENHA });
    expect(login.status).toBe(200);

    const cookies = login.headers['set-cookie'];
    const authCookie = cookies?.find(c => c.startsWith('auth_token='));

    // Exclui a própria conta
    const del = await request(app)
      .delete('/api/me')
      .set('Cookie', authCookie)
      .send({ senha: SENHA });
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    // Confirma que a conta foi removida (login deve falhar)
    const loginAfter = await request(app)
      .post('/api/login')
      .send({ usuario: USUARIO, senha: SENHA });
    expect(loginAfter.status).toBe(401);
  });
});
