'use strict';

/**
 * recibos.test.js — Testes de integração para /api/recibos
 *
 * Cobre (sem DB):
 *  - POST: 401 sem token, 403 visualizador, 400 campos obrigatórios ausentes
 *  - GET: 401 sem token, 403 visualizador aceita (visualizador pode listar)
 *  - PUT /assinar: 401 sem token, 403 visualizador
 *
 * Cobre (com DB — SKIP_DB_TESTS=true para pular):
 *  - POST registra recibo e retorna número sequencial
 *  - Dois POSTs no mesmo ano geram números consecutivos
 *  - GET lista inclui recibo criado, filtra por ano
 *  - PUT /assinar define assinado_em
 */

const request = require('supertest');
const { app, getAdminToken, makeToken } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// ── POST ───────────────────────────────────────────────────────────────────

describe('POST /api/recibos — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/recibos')
      .send({ fornecedor_nome: 'JOAO', data: '2026-05-01', valor: 500 });
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .post('/api/recibos')
      .set('Authorization', 'Bearer ' + token)
      .send({ fornecedor_nome: 'JOAO', data: '2026-05-01', valor: 500 });
    expect(res.status).toBe(403);
  });

  test('fornecedor_nome ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/recibos')
      .set('Authorization', 'Bearer ' + token)
      .send({ data: '2026-05-01', valor: 500 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('data com formato inválido retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/recibos')
      .set('Authorization', 'Bearer ' + token)
      .send({ fornecedor_nome: 'JOAO', data: '01/05/2026', valor: 500 });
    expect(res.status).toBe(400);
  });

  test('valor ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/recibos')
      .set('Authorization', 'Bearer ' + token)
      .send({ fornecedor_nome: 'JOAO', data: '2026-05-01' });
    expect(res.status).toBe(400);
  });

  test('valor negativo retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/recibos')
      .set('Authorization', 'Bearer ' + token)
      .send({ fornecedor_nome: 'JOAO', data: '2026-05-01', valor: -100 });
    expect(res.status).toBe(400);
  });
});

// ── GET ───────────────────────────────────────────────────────────────────

describe('GET /api/recibos — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/recibos');
    expect(res.status).toBe(401);
  });

  test('visualizador retorna 200 ou 501', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/recibos')
      .set('Authorization', 'Bearer ' + token);
    expect([200, 501]).toContain(res.status);
  });
});

// ── PUT /assinar ──────────────────────────────────────────────────────────

describe('PUT /api/recibos/:id/assinar — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).put('/api/recibos/1/assinar');
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .put('/api/recibos/1/assinar')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(403);
  });
});

// ── Fluxo completo (requer DB) ────────────────────────────────────────────

describe('Fluxo completo de recibo — com DB', () => {
  let adminToken;
  let reciboId1, reciboId2, reciboNumero1;
  const ANO_TESTE = 2099; // ano improvável para não colidir com dados reais

  beforeAll(async () => { adminToken = await getAdminToken(); });

  dbTest('POST registra recibo e retorna número sequencial', async () => {
    const res = await request(app)
      .post('/api/recibos')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ fornecedor_nome: 'AUTONOMO TESTE', fornecedor_cpf: '000.000.000-00',
              data: `${ANO_TESTE}-06-01`, valor: 1000.00, descricao: 'Teste recibo 1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.numero).toBe('number');
    expect(res.body.numero).toBeGreaterThan(0);
    expect(res.body.ano).toBe(ANO_TESTE);
    expect(res.body.formatted).toMatch(/^\d{4}\/\d{4}$/);
    reciboId1    = res.body.id;
    reciboNumero1 = res.body.numero;
  });

  dbTest('segundo POST no mesmo ano gera número consecutivo', async () => {
    const res = await request(app)
      .post('/api/recibos')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ fornecedor_nome: 'AUTONOMO TESTE 2', data: `${ANO_TESTE}-06-02`, valor: 500.00 });
    expect(res.status).toBe(200);
    expect(res.body.numero).toBe(reciboNumero1 + 1); // número imediatamente seguinte
    reciboId2 = res.body.id;
  });

  dbTest('GET lista retorna recibos do ano com paginação', async () => {
    const res = await request(app)
      .get(`/api/recibos?ano=${ANO_TESTE}`)
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.recibos)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.recibos.length).toBeGreaterThanOrEqual(1);
    const found = res.body.recibos.find(r => r.id === reciboId1);
    expect(found).toBeDefined();
    expect(found.assinado_em).toBeNull();
  });

  dbTest('GET filtro por nome de fornecedor funciona', async () => {
    const res = await request(app)
      .get(`/api/recibos?ano=${ANO_TESTE}&busca=AUTONOMO+TESTE+2`)
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.recibos.some(r => r.id === reciboId2)).toBe(true);
  });

  dbTest('PUT /assinar define assinado_em', async () => {
    if (!reciboId1) return;
    const res = await request(app)
      .put(`/api/recibos/${reciboId1}/assinar`)
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // confirma que assinado_em foi preenchido
    const list = await request(app)
      .get(`/api/recibos?ano=${ANO_TESTE}`)
      .set('Authorization', 'Bearer ' + adminToken);
    const r = list.body.recibos.find(x => x.id === reciboId1);
    expect(r.assinado_em).not.toBeNull();
  });

  dbTest('PUT /assinar em id inexistente retorna 404', async () => {
    const res = await request(app)
      .put('/api/recibos/999999/assinar')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(404);
  });
});
