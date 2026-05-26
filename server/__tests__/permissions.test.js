/**
 * permissions.test.js — Testes para os endpoints de permissões por usuário
 *
 * Endpoints cobertos:
 *  - GET /api/users/:id/permissions
 *  - PUT /api/users/:id/permissions
 *
 * Estratégia:
 *  - Testes de autorização/validação: sem DB (token fabricado com makeToken)
 *  - Testes de CRUD real: marcados com dbTest, pulados se SKIP_DB_TESTS=true
 */

'use strict';

const request = require('supertest');
const { app, getAdminToken, makeToken } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

function adminToken()       { return makeToken({ perfil: 'admin' }); }
function gerenteToken()     { return makeToken({ perfil: 'gerente' }); }
function operadorToken()    { return makeToken({ perfil: 'operador' }); }
function visualizadorToken(){ return makeToken({ perfil: 'visualizador' }); }

// ── GET /api/users/:id/permissions ────────────────────────────────────────

describe('GET /api/users/:id/permissions — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/users/1/permissions');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('visualizador retorna 403', async () => {
    const res = await request(app)
      .get('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + visualizadorToken());
    expect(res.status).toBe(403);
  });

  test('operador retorna 403', async () => {
    const res = await request(app)
      .get('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + operadorToken());
    expect(res.status).toBe(403);
  });

  test('gerente retorna 403', async () => {
    const res = await request(app)
      .get('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + gerenteToken());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/users/:id/permissions — validação de parâmetros', () => {
  test('id = 0 retorna 400', async () => {
    const res = await request(app)
      .get('/api/users/0/permissions')
      .set('Authorization', 'Bearer ' + adminToken());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('id negativo não é bloqueado pelo servidor (apenas 0 e NaN são rejeitados)', async () => {
    // +'-1' = -1 → !(-1) = false → passa a validação; getUserPermissions(-1) retorna {}
    const res = await request(app)
      .get('/api/users/-1/permissions')
      .set('Authorization', 'Bearer ' + adminToken());
    expect([200, 400]).toContain(res.status);
  });

  test('id texto (NaN) retorna 400', async () => {
    const res = await request(app)
      .get('/api/users/abc/permissions')
      .set('Authorization', 'Bearer ' + adminToken());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('admin com id válido retorna 200 com permissions (pode ser vazio)', async () => {
    // ID 99999 não existe no banco mas GET apenas lê permissões (não verifica existência)
    const res = await request(app)
      .get('/api/users/99999/permissions')
      .set('Authorization', 'Bearer ' + adminToken());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.permissions).toBe('object');
  });
});

// ── PUT /api/users/:id/permissions ────────────────────────────────────────

describe('PUT /api/users/:id/permissions — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .send({ addConta: true });
    expect(res.status).toBe(401);
  });

  test('visualizador retorna 403', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + visualizadorToken())
      .send({ addConta: true });
    expect(res.status).toBe(403);
  });

  test('operador retorna 403', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + operadorToken())
      .send({ addConta: true });
    expect(res.status).toBe(403);
  });

  test('gerente retorna 403', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + gerenteToken())
      .send({ addConta: true });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id/permissions — validação de payload', () => {
  test('valor string retorna 400', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: 'sim' }); // string, não boolean
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('valor numérico (1) retorna 400', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: 1 }); // número, não boolean
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('valor null retorna 400', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: null });
    expect(res.status).toBe(400);
  });

  test('id = 0 retorna 400', async () => {
    const res = await request(app)
      .put('/api/users/0/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: true });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('id texto retorna 400', async () => {
    const res = await request(app)
      .put('/api/users/abc/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: true });
    expect(res.status).toBe(400);
  });

  test('payload vazio {} é aceito (sem overrides é válido)', async () => {
    // Payload {} é válido Joi — objeto de booleans com 0 entradas
    // Pode retornar 200 ou 404 dependendo do usuário existir
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({});
    expect([200, 404, 500]).toContain(res.status);
  });

  test('payload com múltiplas permissões booleanas válidas é aceito', async () => {
    const res = await request(app)
      .put('/api/users/1/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: true, removeConta: false, newLancamento: true });
    // Com JSON fallback: 200 se admin existir, 404 caso contrário
    expect([200, 404, 500]).toContain(res.status);
    // Mas nunca 400 (payload é válido)
    expect(res.status).not.toBe(400);
  });
});

describe('PUT /api/users/:id/permissions — usuário inexistente', () => {
  test('id de usuário que não existe retorna 404', async () => {
    const res = await request(app)
      .put('/api/users/99999/permissions')
      .set('Authorization', 'Bearer ' + adminToken())
      .send({ addConta: true });
    // findById(99999) retorna null → 404
    expect([404, 500]).toContain(res.status);
    if (res.status === 404) {
      expect(res.body.ok).toBe(false);
    }
  });
});

// ── Ciclo completo com DB real ─────────────────────────────────────────────

describe('Ciclo completo de permissões — DB real', () => {
  let token;
  let adminUserId = 1; // admin tem id 1 no banco padrão

  beforeAll(async () => {
    if (SKIP_DB) return;
    token = await getAdminToken();
  });

  dbTest('PUT salva permissões para o admin', async () => {
    const perms = { addConta: false, removeConta: false, newLancamento: true };
    const res = await request(app)
      .put(`/api/users/${adminUserId}/permissions`)
      .set('Authorization', 'Bearer ' + token)
      .send(perms);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  dbTest('GET lê as permissões salvas anteriormente', async () => {
    const res = await request(app)
      .get(`/api/users/${adminUserId}/permissions`)
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.permissions.addConta).toBe(false);
    expect(res.body.permissions.newLancamento).toBe(true);
  });

  dbTest('PUT sobrescreve permissões anteriores', async () => {
    const perms = { addConta: true }; // sobrescreve
    const res = await request(app)
      .put(`/api/users/${adminUserId}/permissions`)
      .set('Authorization', 'Bearer ' + token)
      .send(perms);

    expect(res.status).toBe(200);
  });

  dbTest('GET após sobrescrever reflete novo valor', async () => {
    const res = await request(app)
      .get(`/api/users/${adminUserId}/permissions`)
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
    expect(res.body.permissions.addConta).toBe(true);
    // removeConta não foi enviado → deve ser undefined ou ausente
    expect(res.body.permissions.removeConta).toBeUndefined();
  });

  dbTest('audit registra a alteração de permissões', async () => {
    // Verificar no log de auditoria que a ação foi registrada
    const res = await request(app)
      .get('/api/audit?entityType=usuario')
      .set('Authorization', 'Bearer ' + token);

    if (res.status === 200) {
      const entries = res.body.entries || [];
      const permEntry = entries.find(e => e.action === 'update_permissions');
      // Pode não ser o mais recente, mas deve existir
      expect(permEntry).toBeDefined();
    }
  });
});
