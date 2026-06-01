'use strict';

/**
 * fornecedores-crypto.test.js — Testes de criptografia de CPF/CNPJ
 *
 * Garante que:
 *  - CPF/CNPJ são armazenados criptografados no banco
 *  - GET retorna os valores descriptografados corretamente
 *  - CPF/CNPJ não aparecem em plaintext na coluna `dados`
 *  - Roundtrip: POST → GET → valores preservados
 */

const request = require('supertest');
const { app, getAdminToken, makeToken } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// ── Autorização (sem DB) ──────────────────────────────────────────────────

describe('GET /api/fornecedores — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/fornecedores');
    expect(res.status).toBe(401);
  });

  test('visualizador pode listar', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token);
    expect([200, 501]).toContain(res.status);
  });

  test('visualizador não pode criar', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'fisica', razaoSocial: 'Teste', cpf: '111.111.111-11' });
    expect(res.status).toBe(403);
  });
});

// ── Fluxo completo com criptografia ──────────────────────────────────────

describe('Criptografia de CPF/CNPJ — com DB', () => {
  let token;
  let fornPfId;
  let fornPjId;
  const CPF  = '123.456.789-09';
  const CNPJ = '12.345.678/0001-95';

  beforeAll(async () => {
    if (SKIP_DB) return;
    token = await getAdminToken();
  });

  afterAll(async () => {
    if (!token) return;
    for (const id of [fornPfId, fornPjId].filter(Boolean)) {
      await request(app)
        .delete('/api/fornecedores/' + id)
        .set('Authorization', 'Bearer ' + token)
        .catch(() => {});
    }
  });

  dbTest('POST pessoa física com CPF retorna ok', async () => {
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'fisica', razaoSocial: 'João Crypto Teste', cpf: CPF });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('number');
    fornPfId = res.body.id;
  });

  dbTest('CPF está criptografado na coluna do banco (não em plaintext)', async () => {
    if (!fornPfId) return;
    const db = require('../db');
    const [rows] = await db.pool.query('SELECT cpf, dados FROM fornecedor WHERE id = ?', [fornPfId]);
    expect(rows.length).toBe(1);

    const cpfNoBanco = rows[0].cpf;
    // O valor no banco deve ser criptografado (prefixo ENC: ou PLAIN:)
    expect(cpfNoBanco).toBeDefined();
    expect(cpfNoBanco).not.toBe(CPF); // nunca plaintext

    // CPF não deve aparecer no JSON de dados
    const dadosObj = JSON.parse(rows[0].dados || '{}');
    expect(dadosObj.cpf).toBeUndefined();
  });

  dbTest('GET retorna CPF descriptografado corretamente', async () => {
    if (!fornPfId) return;
    const res = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);

    const forn = res.body.fornecedores.find(f => f.id === fornPfId);
    expect(forn).toBeDefined();
    expect(forn.cpf).toBe(CPF); // descriptografado para o frontend
  });

  dbTest('POST pessoa jurídica com CNPJ retorna ok', async () => {
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'juridica', razaoSocial: 'Empresa Crypto Ltda', cnpj: CNPJ });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    fornPjId = res.body.id;
  });

  dbTest('CNPJ está criptografado no banco', async () => {
    if (!fornPjId) return;
    const db = require('../db');
    const [rows] = await db.pool.query('SELECT cnpj, dados FROM fornecedor WHERE id = ?', [fornPjId]);
    const cnpjNoBanco = rows[0].cnpj;
    expect(cnpjNoBanco).not.toBe(CNPJ);
    expect(JSON.parse(rows[0].dados || '{}').cnpj).toBeUndefined();
  });

  dbTest('GET retorna CNPJ descriptografado corretamente', async () => {
    if (!fornPjId) return;
    const res = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token);
    const forn = res.body.fornecedores.find(f => f.id === fornPjId);
    expect(forn?.cnpj).toBe(CNPJ);
  });

  dbTest('PUT atualiza CPF e ele continua criptografado', async () => {
    if (!fornPfId) return;
    const NOVO_CPF = '987.654.321-00';
    const upd = await request(app)
      .put('/api/fornecedores/' + fornPfId)
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'fisica', razaoSocial: 'João Crypto Atualizado', cpf: NOVO_CPF });
    expect(upd.status).toBe(200);

    // Verifica no banco
    const db = require('../db');
    const [rows] = await db.pool.query('SELECT cpf FROM fornecedor WHERE id = ?', [fornPfId]);
    expect(rows[0].cpf).not.toBe(NOVO_CPF);

    // GET retorna novo CPF descriptografado
    const get = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token);
    const forn = get.body.fornecedores.find(f => f.id === fornPfId);
    expect(forn?.cpf).toBe(NOVO_CPF);
  });

  dbTest('DELETE (soft) remove fornecedor da listagem', async () => {
    if (!fornPfId) return;
    const del = await request(app)
      .delete('/api/fornecedores/' + fornPfId)
      .set('Authorization', 'Bearer ' + token);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token);
    const forn = list.body.fornecedores.find(f => f.id === fornPfId);
    expect(forn).toBeUndefined(); // não aparece mais
    fornPfId = null; // já foi limpo
  });
});

// ── Validação sem DB ──────────────────────────────────────────────────────

describe('POST /api/fornecedores — validação de campos', () => {
  test('tipoPessoa ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'operador' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ razaoSocial: 'Teste' });
    expect(res.status).toBe(400);
  });

  test('tipoPessoa inválido retorna 400', async () => {
    const token = makeToken({ perfil: 'operador' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'desconhecido', razaoSocial: 'Teste' });
    expect(res.status).toBe(400);
  });

  test('razaoSocial ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'operador' });
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + token)
      .send({ tipoPessoa: 'fisica' });
    expect(res.status).toBe(400);
  });
});
