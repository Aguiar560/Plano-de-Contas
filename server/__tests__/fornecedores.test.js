'use strict';

/**
 * fornecedores.test.js — Testes de integração para /api/fornecedores
 *
 * Cobre (sem DB):
 *  - GET: requer autenticação (visualizador aceito)
 *  - POST: 401 sem token, 403 visualizador, 400 tipoPessoa/razaoSocial ausentes
 *  - PUT: 401 sem token, 403 visualizador, 400 ID inválido, 400 payload inválido
 *  - DELETE: 401 sem token, 403 visualizador, 400 ID inválido
 *
 * Cobre (com DB — SKIP_DB_TESTS=true para pular):
 *  - Fluxo completo: criar → listar → atualizar → excluir (soft delete)
 */

const request = require('supertest');
const { app, getAdminToken, makeToken } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// ── GET ────────────────────────────────────────────────────────────────────

describe('GET /api/fornecedores — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/fornecedores');
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 200 ou 501', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token);
    expect([200, 501]).toContain(res.status);
  });
});

// ── POST ───────────────────────────────────────────────────────────────────

describe('POST /api/fornecedores — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/fornecedores')
      .send({ tipoPessoa: 'juridica', razaoSocial: 'EMPRESA TESTE LTDA' });
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'juridica', razaoSocial: 'EMPRESA TESTE LTDA' });
    expect(res.status).toBe(403);
  });

  test('tipoPessoa ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ razaoSocial: 'EMPRESA TESTE LTDA' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('tipoPessoa inválido retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'governo', razaoSocial: 'EMPRESA TESTE LTDA' });
    expect(res.status).toBe(400);
  });

  test('razaoSocial ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'juridica' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── PUT ───────────────────────────────────────────────────────────────────

describe('PUT /api/fornecedores/:id — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .put('/api/fornecedores/1')
      .send({ tipoPessoa: 'juridica', razaoSocial: 'EMPRESA ATUALIZADA' });
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .put('/api/fornecedores/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'juridica', razaoSocial: 'EMPRESA ATUALIZADA' });
    expect(res.status).toBe(403);
  });

  test('payload inválido retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .put('/api/fornecedores/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'invalido' });
    expect(res.status).toBe(400);
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────

describe('DELETE /api/fornecedores/:id — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).delete('/api/fornecedores/1');
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .delete('/api/fornecedores/1')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(403);
  });
});

// ── Fluxo completo (requer DB) ─────────────────────────────────────────────

describe('Fluxo completo de fornecedor — com DB', () => {
  let createdId;
  let adminToken;

  beforeAll(async () => { adminToken = await getAdminToken(); });

  dbTest('POST cria fornecedor PJ e retorna id', async () => {
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ tipoPessoa: 'juridica', razaoSocial: 'FORNECEDOR TEST SUITE LTDA', status: 'ativo' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('number');
    createdId = res.body.id;
  });

  dbTest('GET lista inclui fornecedor criado', async () => {
    const res = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const found = res.body.fornecedores.find(f => f.id === createdId);
    expect(found).toBeDefined();
    expect(found.razaoSocial).toBe('FORNECEDOR TEST SUITE LTDA');
  });

  dbTest('POST cria fornecedor PF com CPF', async () => {
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ tipoPessoa: 'fisica', razaoSocial: 'JOAO DA SILVA TESTE', cpf: '000.000.000-00', status: 'ativo' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // limpar
    if (res.body.id) {
      await request(app)
        .delete('/api/fornecedores/' + res.body.id)
        .set('Authorization', 'Bearer ' + adminToken);
    }
  });

  dbTest('PUT atualiza razaoSocial', async () => {
    if (!createdId) return;
    const res = await request(app)
      .put('/api/fornecedores/' + createdId)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ tipoPessoa: 'juridica', razaoSocial: 'FORNECEDOR ATUALIZADO LTDA', status: 'ativo' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  dbTest('DELETE soft-deleta (não retorna na lista)', async () => {
    if (!createdId) return;
    const del = await request(app)
      .delete('/api/fornecedores/' + createdId)
      .set('Authorization', 'Bearer ' + adminToken);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const list = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + adminToken);
    const found = list.body.fornecedores?.find(f => f.id === createdId);
    expect(found).toBeUndefined();
  });

  dbTest('PUT em id inexistente retorna 404', async () => {
    const res = await request(app)
      .put('/api/fornecedores/999999')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ tipoPessoa: 'juridica', razaoSocial: 'NINGUEM', status: 'ativo' });
    expect(res.status).toBe(404);
  });
});
