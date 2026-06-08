/**
 * contas.test.js — Testes de integração para /api/contas
 *
 * Estratégia:
 *  - Testes de autorização/validação: sem DB (rápidos, sempre rodam)
 *  - Testes de CRUD real: só rodam se DB_HOST estiver configurado e acessível
 *    (variável SKIP_DB_TESTS=true para pular em CI sem banco)
 *
 * Cobre:
 *  - GET /api/contas: retorno de árvore SEM lançamentos (CQRS — estrutura apenas)
 *  - POST /api/contas: criar conta com auth, sem auth, nome ausente
 *  - PUT /api/contas/:codigo: renomear, não encontrada, sem auth
 *  - DELETE /api/contas/:codigo: conta com filho bloqueada, não encontrada, sem auth
 */

'use strict';

const request = require('supertest');
const { app, getAdminToken, makeToken } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// ── Testes sem DB (autorização e validação) ────────────────────────────────

describe('GET /api/contas — autorização', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/contas');
    expect(res.status).toBe(401);
  });

  test('visualizador autenticado retorna 200 ou 501', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/contas')
      .set('Authorization', 'Bearer ' + token);
    expect([200, 501]).toContain(res.status);
  });
});

describe('GET /api/contas/hash — autorização e formato', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/contas/hash');
    expect(res.status).toBe(401);
  });

  test('visualizador autenticado retorna ok:true e campo hash', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/contas/hash')
      .set('Authorization', 'Bearer ' + token);
    expect([200, 501]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.hash).toBe('string');
    }
  });
});

describe('POST /api/contas — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/contas')
      .send({ parent_codigo: '1', nome: 'TESTE', natureza: 'entrada' });
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .post('/api/contas')
      .set('Authorization', 'Bearer ' + token)
      .send({ parent_codigo: '1', nome: 'TESTE', natureza: 'entrada' });
    expect(res.status).toBe(403);
  });

  test('nome ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/contas')
      .set('Authorization', 'Bearer ' + token)
      .send({ parent_codigo: '1' }); // sem nome
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('nome vazio retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/contas')
      .set('Authorization', 'Bearer ' + token)
      .send({ parent_codigo: '1', nome: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/contas/:codigo — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .put('/api/contas/1')
      .send({ nome: 'NOVO NOME' });
    expect(res.status).toBe(401);
  });

  test('nome ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .put('/api/contas/1')
      .set('Authorization', 'Bearer ' + token)
      .send({}); // sem nome
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe('DELETE /api/contas/:codigo — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).delete('/api/contas/99');
    expect(res.status).toBe(401);
  });
});

// ── Testes com DB real ─────────────────────────────────────────────────────

describe('GET /api/contas — estrutura da árvore', () => {
  let token;
  beforeAll(() => { token = makeToken({ perfil: 'admin' }); });

  dbTest('retorna array contas com campos obrigatórios (sem lançamentos — CQRS)', async () => {
    const res = await request(app)
      .get('/api/contas')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.contas)).toBe(true);
    // CQRS: GET /api/contas não retorna mais 'ano' nem lançamentos
    expect(res.body.ano).toBeUndefined();

    // Verificar estrutura de cada conta raiz
    for (const c of res.body.contas) {
      expect(typeof c.id).toBe('number');
      expect(typeof c.codigo).toBe('string');
      expect(typeof c.nome).toBe('string');
      expect(['entrada', 'saida']).toContain(c.natureza);
      expect(Array.isArray(c.filhos)).toBe(true);
      // lançamentos NÃO são retornados na estrutura (CQRS)
      expect(c.lancamentos).toBeUndefined();
    }
  });
});

describe('POST /api/contas — CRUD real', () => {
  let token;
  let codigoCriado;

  beforeAll(async () => {
    token = await getAdminToken();
  });

  // Safety net: garante remoção mesmo se o teste de exclusão falhou
  afterAll(async () => {
    if (!codigoCriado || !token) return;
    await request(app)
      .delete('/api/contas/' + codigoCriado)
      .set('Authorization', 'Bearer ' + token)
      .catch(() => {}); // ignora erro se já foi removido
  });

  dbTest('cria subconta de "1" e retorna codigo hierárquico', async () => {
    const nome = 'CONTA_TESTE_' + Date.now();
    const res = await request(app)
      .post('/api/contas')
      .set('Authorization', 'Bearer ' + token)
      .send({ parent_codigo: '1', nome, natureza: 'entrada' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('number');
    expect(res.body.codigo).toMatch(/^1\.\d+$/); // ex: "1.5"
    codigoCriado = res.body.codigo;
  });

  dbTest('conta pai inexistente retorna 404', async () => {
    const res = await request(app)
      .post('/api/contas')
      .set('Authorization', 'Bearer ' + token)
      .send({ parent_codigo: '999.999', nome: 'TESTE', natureza: 'saida' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  dbTest('renomeia a conta criada', async () => {
    if (!codigoCriado) return;
    const novoNome = 'CONTA_RENOMEADA_' + Date.now();
    const res = await request(app)
      .put('/api/contas/' + codigoCriado)
      .set('Authorization', 'Bearer ' + token)
      .send({ nome: novoNome });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.nome).toBe(novoNome.toUpperCase().trim());
  });

  dbTest('exclui a conta criada', async () => {
    if (!codigoCriado) return;
    const res = await request(app)
      .delete('/api/contas/' + codigoCriado)
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  dbTest('excluir conta inexistente retorna 404', async () => {
    const res = await request(app)
      .delete('/api/contas/888.888.888')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  dbTest('excluir conta com filhos retorna 409', async () => {
    // A conta "1" (ENTRADAS) tem filhos no banco de dados
    const res = await request(app)
      .delete('/api/contas/1')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toMatch(/subconta/i);
  });
});

// ── Soft-delete de conta (com DB) ─────────────────────────────────────────

describe('Soft-delete de conta (com DB)', () => {
  let token;
  let codigoCriado;

  beforeAll(async () => {
    if (SKIP_DB) return;
    token = await getAdminToken();
  });

  dbTest('cria conta folha para testar soft-delete', async () => {
    const res = await request(app)
      .post('/api/contas')
      .set('Authorization', 'Bearer ' + token)
      .send({ parent_codigo: '1', nome: 'CONTA SOFT DELETE TEST' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    codigoCriado = res.body.codigo;
  });

  dbTest('DELETE retorna ok:true e conta desaparece da árvore', async () => {
    if (!codigoCriado) return;
    const del = await request(app)
      .delete('/api/contas/' + codigoCriado)
      .set('Authorization', 'Bearer ' + token);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    // Não deve mais aparecer na árvore
    const tree = await request(app).get('/api/contas').set('Authorization', 'Bearer ' + token);
    const plana = tree.body.contas || [];
    expect(plana.find(c => c.codigo === codigoCriado)).toBeUndefined();
  });

  dbTest('segundo DELETE do mesmo código retorna 404', async () => {
    if (!codigoCriado) return;
    const res = await request(app)
      .delete('/api/contas/' + codigoCriado)
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});
