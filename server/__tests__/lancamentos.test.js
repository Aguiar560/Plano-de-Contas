/**
 * lancamentos.test.js — Testes de integração para /api/lancamentos
 *
 * Cobre:
 *  - POST sem token retorna 401
 *  - POST com campos obrigatórios faltando retorna 400
 *  - POST com conta inexistente retorna 400
 *  - POST bem-sucedido retorna id
 *  - PUT /api/lancamentos/:id — edição (sem token, visualizador, data inválida, sucesso)
 *  - DELETE sem token retorna 401
 *  - DELETE de id inexistente retorna 404
 *  - DELETE bem-sucedido retorna ok:true
 *  - Fluxo completo: criar → editar → verificar na árvore → excluir
 */

'use strict';

const request = require('supertest');
const { app, getAdminToken, makeToken } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// Descrições usadas pelos lançamentos criados nos testes — qualquer registro
// com uma delas é lixo de teste e deve ser removido DEFINITIVAMENTE do banco
// (hard delete, não soft delete, para não acumular resíduos a cada execução).
const TEST_MARKERS = [
  'Lançamento de teste automatizado',
  'Lançamento editado pelo teste',
  'softdelete-test',
  'OFX bulk teste A',
  'OFX bulk teste B',
];

async function limparResiduosDeTeste() {
  if (SKIP_DB) return;
  const db = require('../db');
  const placeholders = TEST_MARKERS.map(() => '?').join(', ');
  await db.pool
    .query(`DELETE FROM lancamento WHERE descricao IN (${placeholders})`, TEST_MARKERS)
    .catch(() => {});
}

// ── Testes sem DB (autorização e validação) ────────────────────────────────

describe('POST /api/lancamentos — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/lancamentos')
      .send({ conta_codigo: '1', data: '2026-05-01', tipo: 'credito', valor: 100 });
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .post('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', data: '2026-05-01', tipo: 'credito', valor: 100 });
    expect(res.status).toBe(403);
  });

  test('campo data ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', tipo: 'credito', valor: 100 }); // sem data
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('campo tipo ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', data: '2026-05-01', valor: 100 }); // sem tipo
    expect(res.status).toBe(400);
  });

  test('campo valor ausente retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .post('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', data: '2026-05-01', tipo: 'debito' }); // sem valor
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/lancamentos/:id — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .put('/api/lancamentos/1')
      .send({ data: '2026-05-01', tipo: 'credito', valor: 50 });
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .put('/api/lancamentos/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ data: '2026-05-01', tipo: 'credito', valor: 50 });
    expect(res.status).toBe(403);
  });

  test('data com formato inválido retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .put('/api/lancamentos/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ data: '01/05/2026', tipo: 'credito', valor: 50 }); // formato errado
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('tipo inválido retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .put('/api/lancamentos/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ data: '2026-05-01', tipo: 'invalido', valor: 50 });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/lancamentos/:id — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app).delete('/api/lancamentos/1');
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .delete('/api/lancamentos/1')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(403);
  });

  test('id não numérico retorna 400', async () => {
    const token = makeToken({ perfil: 'admin' });
    const res = await request(app)
      .delete('/api/lancamentos/nao-e-numero')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(400);
  });
});

// ── Testes com DB real ─────────────────────────────────────────────────────

describe('Fluxo completo de lançamento — DB real', () => {
  let token;
  let lancamentoCriadoId;

  beforeAll(async () => {
    token = await getAdminToken();
    // Limpar resíduos de execuções anteriores que falharam antes do cleanup
    await limparResiduosDeTeste();
  });

  // Safety net: remove tudo que este describe criou, mesmo se algum teste falhou
  afterAll(limparResiduosDeTeste);

  dbTest('cria lançamento na conta "1" e retorna id numérico', async () => {
    const res = await request(app)
      .post('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token)
      .send({
        conta_codigo: '1',
        data: '2026-05-01',
        tipo: 'credito',
        valor: 99.99,
        descricao: 'Lançamento de teste automatizado'
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('number');
    lancamentoCriadoId = res.body.id;
  });

  dbTest('lançamento criado aparece em GET /api/lancamentos?ano=2026 (CQRS)', async () => {
    if (!lancamentoCriadoId) return;

    const res = await request(app)
      .get('/api/lancamentos?ano=2026')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.lancamentos)).toBe(true);

    const lanc = res.body.lancamentos.find(l => l.id === lancamentoCriadoId);
    expect(lanc).toBeDefined();
    expect(lanc.tipo).toBe('credito');
    expect(lanc.valor).toBeCloseTo(99.99, 1);
    expect(lanc.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  dbTest('edita o lançamento criado (valor e descrição)', async () => {
    if (!lancamentoCriadoId) return;

    const res = await request(app)
      .put('/api/lancamentos/' + lancamentoCriadoId)
      .set('Authorization', 'Bearer ' + token)
      .send({
        data: '2026-05-02',
        tipo: 'credito',
        valor: 150.00,
        descricao: 'Lançamento editado pelo teste'
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.valor).toBe(150);
    expect(res.body.data).toBe('2026-05-02');
  });

  dbTest('exclui o lançamento criado', async () => {
    if (!lancamentoCriadoId) return;

    const res = await request(app)
      .delete('/api/lancamentos/' + lancamentoCriadoId)
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe(lancamentoCriadoId);
  });

  dbTest('após exclusão, lançamento não aparece mais em GET /api/lancamentos?ano (CQRS)', async () => {
    if (!lancamentoCriadoId) return;

    const res = await request(app)
      .get('/api/lancamentos?ano=2026')
      .set('Authorization', 'Bearer ' + token);
    const lanc = (res.body.lancamentos || []).find(l => l.id === lancamentoCriadoId);
    expect(lanc).toBeUndefined();
  });

  dbTest('excluir id inexistente retorna 404', async () => {
    const res = await request(app)
      .delete('/api/lancamentos/999999')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  dbTest('conta inexistente retorna 400', async () => {
    const res = await request(app)
      .post('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token)
      .send({
        conta_codigo: '999.999',
        data: '2026-05-01',
        tipo: 'credito',
        valor: 50
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toMatch(/conta/i);
  });
});

// ── Soft-delete — lançamento excluído não reaparece na paginação ───────────

describe('Soft-delete de lançamento (com DB)', () => {
  let token;
  let idCriado;

  beforeAll(async () => {
    if (SKIP_DB) return;
    token = await getAdminToken();
  });

  // Remove definitivamente o lançamento 'softdelete-test', mesmo se algum teste falhou
  afterAll(limparResiduosDeTeste);

  dbTest('cria lançamento para testar soft-delete', async () => {
    const res = await request(app)
      .post('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', data: '2026-06-15', tipo: 'debito', valor: 1.11, descricao: 'softdelete-test' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    idCriado = res.body.id;
  });

  dbTest('DELETE retorna ok:true mas GET não retorna o lançamento', async () => {
    if (!idCriado) return;
    // Soft-delete
    const del = await request(app)
      .delete('/api/lancamentos/' + idCriado)
      .set('Authorization', 'Bearer ' + token);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    // Não deve aparecer no GET paginado (endpoint usa conta_id, não conta_codigo)
    const get = await request(app)
      .get('/api/lancamentos?conta_id=1&page=1&limit=200')
      .set('Authorization', 'Bearer ' + token);
    expect(get.status).toBe(200);
    const ids = (get.body.lancamentos || []).map(l => l.id);
    expect(ids).not.toContain(idCriado);
  });

  dbTest('segundo DELETE do mesmo id retorna 404 (já está soft-deleted)', async () => {
    if (!idCriado) return;
    const res = await request(app)
      .delete('/api/lancamentos/' + idCriado)
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

// ── Paginação de GET /api/lancamentos ─────────────────────────────────────

describe('GET /api/lancamentos — paginação e validação', () => {
  test('sem conta_id e sem ano retorna 400', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/lancamentos')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('?ano=2026 sem conta_id retorna 200 ou 501 (modo CQRS)', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/lancamentos?ano=2026')
      .set('Authorization', 'Bearer ' + token);
    expect([200, 501]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.lancamentos)).toBe(true);
      expect(res.body.ano).toBe(2026);
    }
  });

  test('?ano=1800 retorna 400 (ano fora do range)', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/lancamentos?ano=1800')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('limit > 200 retorna 400', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/lancamentos?conta_id=1&limit=201')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('page < 1 retorna 400', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/lancamentos?conta_id=1&page=0')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('ordem inválida retorna 400', async () => {
    // O endpoint aceita: data-desc | data-asc | valor-desc | valor-asc
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .get('/api/lancamentos?conta_id=1&ordem=invalido')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── POST /api/lancamentos/bulk — importação OFX/CSV em lote ─────────────────

describe('POST /api/lancamentos/bulk — validação sem DB', () => {
  test('sem token retorna 401', async () => {
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .send({ conta_codigo: '1', lancamentos: [{ data: '2026-05-01', tipo: 'credito', valor: 10 }] });
    expect(res.status).toBe(401);
  });

  test('token de visualizador retorna 403', async () => {
    const token = makeToken({ perfil: 'visualizador' });
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', lancamentos: [{ data: '2026-05-01', tipo: 'credito', valor: 10 }] });
    expect(res.status).toBe(403);
  });

  test('sem conta_id nem conta_codigo retorna 400', async () => {
    const token = makeToken({ perfil: 'operador' });
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({ lancamentos: [{ data: '2026-05-01', tipo: 'credito', valor: 10 }] });
    expect(res.status).toBe(400);
  });

  test('array de lançamentos vazio retorna 400', async () => {
    const token = makeToken({ perfil: 'operador' });
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', lancamentos: [] });
    expect(res.status).toBe(400);
  });

  test('lançamento com tipo inválido retorna 400', async () => {
    const token = makeToken({ perfil: 'operador' });
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({ conta_codigo: '1', lancamentos: [{ data: '2026-05-01', tipo: 'xpto', valor: 10 }] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/lancamentos/bulk — importação e dedup (DB real)', () => {
  let token;
  const FIT_A = 'jesttest|ofx|A|' + Date.now();
  const FIT_B = 'jesttest|ofx|B|' + Date.now();

  beforeAll(async () => {
    if (SKIP_DB) return;
    token = await getAdminToken();
    await limparResiduosDeTeste();
  });
  afterAll(limparResiduosDeTeste);

  dbTest('importa lote novo: inserted = total, skipped = 0', async () => {
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({
        conta_codigo: '1',
        lancamentos: [
          { data: '2026-05-01', tipo: 'credito', valor: 11.11, descricao: 'OFX bulk teste A', fit_id: FIT_A },
          { data: '2026-05-02', tipo: 'debito',  valor: 22.22, descricao: 'OFX bulk teste B', fit_id: FIT_B },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.inserted).toBe(2);
    expect(res.body.skipped).toBe(0);
  });

  dbTest('reimportar o mesmo lote deduplica: inserted = 0, skipped = total', async () => {
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({
        conta_codigo: '1',
        lancamentos: [
          { data: '2026-05-01', tipo: 'credito', valor: 11.11, descricao: 'OFX bulk teste A', fit_id: FIT_A },
          { data: '2026-05-02', tipo: 'debito',  valor: 22.22, descricao: 'OFX bulk teste B', fit_id: FIT_B },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(0);
    expect(res.body.skipped).toBe(2);
  });

  dbTest('deduplica fit_id repetido dentro do próprio lote', async () => {
    const FIT_C = 'jesttest|ofx|C|' + Date.now();
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({
        conta_codigo: '1',
        lancamentos: [
          { data: '2026-05-03', tipo: 'credito', valor: 33.33, descricao: 'OFX bulk teste A', fit_id: FIT_C },
          { data: '2026-05-03', tipo: 'credito', valor: 33.33, descricao: 'OFX bulk teste A', fit_id: FIT_C },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.skipped).toBe(1);
  });

  dbTest('conta inexistente retorna 400', async () => {
    const res = await request(app)
      .post('/api/lancamentos/bulk')
      .set('Authorization', 'Bearer ' + token)
      .send({
        conta_codigo: '999.999',
        lancamentos: [{ data: '2026-05-01', tipo: 'credito', valor: 5, descricao: 'OFX bulk teste A', fit_id: 'x' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
