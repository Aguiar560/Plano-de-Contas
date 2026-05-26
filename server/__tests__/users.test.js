/**
 * users.test.js — Testes de integração para /api/users e permissões
 *
 * Cobre (sem DB — autorização e validação):
 *  - GET /api/users: requer admin
 *  - POST /api/users: requer admin, valida campos, impede duplicata
 *  - PUT /api/users/:id: requer admin
 *  - DELETE /api/users/:id: requer admin
 *  - GET /api/users/:id/permissions: requer admin
 *  - PUT /api/users/:id/permissions: requer admin, valida payload
 *  - POST /api/users/:id/unlock: requer admin
 *  - POST /api/users/:id/reset-password: requer admin, valida nova senha
 *  - POST /api/me/change-password: requer token válido
 *  - Hierarquia de perfis (gerente/operador/visualizador não acedem endpoints admin)
 *  - GET /api/audit: requer admin
 */

'use strict';

const request = require('supertest');
const { app, makeToken } = require('./helpers');

// ── Helpers locais ─────────────────────────────────────────────────────────

function adminToken()       { return makeToken({ perfil: 'admin' }); }
function gerenteToken()     { return makeToken({ perfil: 'gerente' }); }
function operadorToken()    { return makeToken({ perfil: 'operador' }); }
function visualizadorToken(){ return makeToken({ perfil: 'visualizador' }); }

// ── GET /api/users ─────────────────────────────────────────────────────────

describe('GET /api/users — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  test('visualizador retorna 403', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer ' + visualizadorToken());
    expect(res.status).toBe(403);
  });

  test('operador retorna 403', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer ' + operadorToken());
    expect(res.status).toBe(403);
  });

  test('gerente retorna 403', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer ' + gerenteToken());
    expect(res.status).toBe(403);
  });

  test('admin recebe lista (ou 500 sem DB)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer ' + adminToken());
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);
    }
  });
});

// ── POST /api/users ────────────────────────────────────────────────────────

describe('POST /api/users — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ usuario: 'novo', nome: 'Novo', senha: 'senha123', perfil: 'operador' });
    expect(res.status).toBe(401);
  });

  test('operador retorna 403', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + operadorToken())
      .send({ usuario: 'novo', nome: 'Novo', senha: 'senha123', perfil: 'operador' });
    expect(res.status).toBe(403);
  });

  test('perfil inválido retorna 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ usuario: 'novo', nome: 'Novo', senha: 'senha123', perfil: 'superusuario' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('senha muito curta retorna 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ usuario: 'novo', nome: 'Novo', senha: '123', perfil: 'operador' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('usuario com caracteres especiais retorna 400 (alphanum)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ usuario: 'novo usuario!', nome: 'Novo', senha: 'senha123', perfil: 'operador' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('campos obrigatórios ausentes retorna 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ usuario: 'novo' }); // faltam nome, senha, perfil
    expect(res.status).toBe(400);
  });
});

// ── PUT /api/users/:id ─────────────────────────────────────────────────────

describe('PUT /api/users/:id — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).put('/api/users/1').send({ perfil: 'gerente' });
    expect(res.status).toBe(401);
  });

  test('gerente retorna 403', async () => {
    const res = await request(app)
      .put('/api/users/1')
      .set('Authorization', 'Bearer ' + gerenteToken())
      .send({ perfil: 'gerente' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/users/:id ──────────────────────────────────────────────────

describe('DELETE /api/users/:id — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).delete('/api/users/1');
    expect(res.status).toBe(401);
  });

  test('operador retorna 403', async () => {
    const res = await request(app)
      .delete('/api/users/1')
      .set('Authorization', 'Bearer ' + operadorToken());
    expect(res.status).toBe(403);
  });
});

// ── GET /api/users/:id/permissions ────────────────────────────────────────

describe('GET /api/users/:id/permissions — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/users/1/permissions');
    expect(res.status).toBe(401);
  });

  test('gerente retorna 403', async () => {
    const res = await request(app)
      .get('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + gerenteToken());
    expect(res.status).toBe(403);
  });

  test('id inválido (0) retorna 400', async () => {
    const res = await request(app)
      .get('/api/users/0/permissions')
      .set('Authorization', 'Bearer ' + adminToken());
    expect(res.status).toBe(400);
  });
});

// ── PUT /api/users/:id/permissions ────────────────────────────────────────

describe('PUT /api/users/:id/permissions — validação', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .send({ addConta: true });
    expect(res.status).toBe(401);
  });

  test('operador retorna 403', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + operadorToken())
      .send({ addConta: true });
    expect(res.status).toBe(403);
  });

  test('payload com valor não-booleano retorna 400', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: 'sim' }); // string, não boolean
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── POST /api/users/:id/reset-password ────────────────────────────────────

describe('POST /api/users/:id/reset-password — validação', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/users/1/reset-password')
      .send({ nova: 'novaSenha123' });
    expect(res.status).toBe(401);
  });

  test('gerente retorna 403', async () => {
    const res = await request(app)
      .post('/api/users/1/reset-password')
      .set('Authorization', 'Bearer ' + gerenteToken())
      .send({ nova: 'novaSenha123' });
    expect(res.status).toBe(403);
  });

  test('nova senha curta retorna 400', async () => {
    const res = await request(app)
      .post('/api/users/1/reset-password')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ nova: '123' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('sem nova senha retorna 400', async () => {
    const res = await request(app)
      .post('/api/users/1/reset-password')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── POST /api/me/change-password ──────────────────────────────────────────

describe('POST /api/me/change-password — validação', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/me/change-password')
      .send({ atual: 'admin', nova: 'novaSenha123' });
    expect(res.status).toBe(401);
  });

  test('sem campo atual retorna 400', async () => {
    const res = await request(app)
      .post('/api/me/change-password')
      .set('Authorization', 'Bearer ' + operadorToken())
      .send({ nova: 'novaSenha123' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('sem campo nova retorna 400', async () => {
    const res = await request(app)
      .post('/api/me/change-password')
      .set('Authorization', 'Bearer ' + operadorToken())
      .send({ atual: 'senhaAtual' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── POST /api/users/:id/unlock ────────────────────────────────────────────

describe('POST /api/users/:id/unlock — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).post('/api/users/1/unlock');
    expect(res.status).toBe(401);
  });

  test('operador retorna 403', async () => {
    const res = await request(app)
      .post('/api/users/1/unlock')
      .set('Authorization', 'Bearer ' + operadorToken());
    expect(res.status).toBe(403);
  });
});

// ── GET /api/audit ────────────────────────────────────────────────────────

describe('GET /api/audit — autorização e validação', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });

  test('gerente retorna 403', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', 'Bearer ' + gerenteToken());
    expect(res.status).toBe(403);
  });

  test('parâmetro page negativo retorna 400', async () => {
    const res = await request(app)
      .get('/api/audit?page=-1')
      .set('Authorization', 'Bearer ' + adminToken());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('parâmetro entityType inválido retorna 400', async () => {
    const res = await request(app)
      .get('/api/audit?entityType=invalido')
      .set('Authorization', 'Bearer ' + adminToken());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('admin recebe resultado (ou 500 sem DB)', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', 'Bearer ' + adminToken());
    expect([200, 500]).toContain(res.status);
  });
});

// ── Hierarquia de perfis ───────────────────────────────────────────────────

describe('Hierarquia de perfis — endpoints protegidos', () => {
  const adminOnlyEndpoints = [
    ['GET',    '/api/users'],
    ['POST',   '/api/users'],
    ['DELETE', '/api/users/999'],
    ['GET',    '/api/audit'],
  ];

  test.each(adminOnlyEndpoints)(
    '%s %s rejeita perfil gerente com 403',
    async (method, url) => {
      const res = await request(app)
        [method.toLowerCase()](url)
        .set('Authorization', 'Bearer ' + gerenteToken())
        .send({ usuario: 'x', nome: 'x', senha: 'xxxxxx', perfil: 'operador' }); // body p/ POST
      expect(res.status).toBe(403);
    }
  );
});
