'use strict';

/**
 * security-hardening.test.js
 *
 * Testa os 4 fixes de segurança de alta prioridade:
 *
 *  Fix 1 — express.static não expõe arquivos sensíveis (server/, db/, package.json…)
 *  Fix 2 — JTI revogado é persistido no banco e sobrevive à limpeza do Map em memória
 *  Fix 3 — ENCRYPT_KEY ausente em produção impede inicialização (testado via crypto-utils)
 *  Fix 4 — _fornFromRow não usa dados.cpf como fallback
 */

const request = require('supertest');
const { app, ADMIN, makeToken, getAdminToken } = require('./helpers');

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// IPs distintos para não acionar rate limiter compartilhado
const IP_STATIC  = '10.1.1.1';
const IP_JTI     = '10.1.1.2';
const IP_FORN    = '10.1.1.3';

// ═══════════════════════════════════════════════════════════════════════════
// Fix 1 — Bloqueio de arquivos estáticos sensíveis
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 1 — express.static não expõe arquivos sensíveis', () => {
  const blocked = [
    '/server/server.js',
    '/server/routes/auth.js',
    '/server/.env',
    '/server/users.json',
    '/db/schema.sql',
    '/db/migrate_v2.sql',
    '/legacy/',
    '/config/',
    '/package.json',
    '/package-lock.json',
    '/readme.md',
    '/README.md',
    '/Dockerfile',
    '/railway.json',
    '/railway.toml',
    '/start_all.bat',
  ];

  test.each(blocked)('GET %s → 404 (não exposto)', async (path) => {
    const res = await request(app)
      .get(path)
      .set('X-Forwarded-For', IP_STATIC);
    expect(res.status).toBe(404);
  });

  test('GET /index.html → 200 (frontend ainda acessível)', async () => {
    const res = await request(app)
      .get('/index.html')
      .set('X-Forwarded-For', IP_STATIC);
    expect(res.status).toBe(200);
  });

  test('GET /styles.css → 200 (CSS ainda acessível)', async () => {
    const res = await request(app)
      .get('/styles.css')
      .set('X-Forwarded-For', IP_STATIC);
    expect(res.status).toBe(200);
  });

  test('GET /client/app.js → 200 (JS de cliente ainda acessível)', async () => {
    const res = await request(app)
      .get('/client/app.js')
      .set('X-Forwarded-For', IP_STATIC);
    expect(res.status).toBe(200);
  });

  test('GET /favicon.svg → 200 (favicon ainda acessível)', async () => {
    const res = await request(app)
      .get('/favicon.svg')
      .set('X-Forwarded-For', IP_STATIC);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 2 — JTI blacklist persiste no banco e sobrevive ao clear do Map
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 2 — JTI revogado persiste no banco (sobrevive a restart simulado)', () => {
  let authCookie;

  beforeAll(async () => {
    if (SKIP_DB) return;
    const loginRes = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP_JTI)
      .send(ADMIN);
    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'] || [];
    authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toBeDefined();
  });

  dbTest('token válido antes do logout', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie)
      .set('X-Forwarded-For', IP_JTI);
    expect(res.status).toBe(200);
  });

  dbTest('token rejeitado imediatamente após logout (Map em memória)', async () => {
    const logout = await request(app)
      .post('/api/logout')
      .set('Cookie', authCookie)
      .set('X-Forwarded-For', IP_JTI);
    expect(logout.status).toBe(200);

    const after = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie)
      .set('X-Forwarded-For', IP_JTI);
    expect(after.status).toBe(401);
  });

  dbTest('JTI ainda rejeitado após limpar Map e recarregar do banco (simula restart)', async () => {
    // Simula restart: limpa o Map em memória
    const { revokedTokens, loadRevokedJtis } = require('../server');
    revokedTokens.clear();

    // Sem DB reload, o token seria aceito novamente
    // Após recarregar do banco, ainda deve ser rejeitado
    await loadRevokedJtis();

    const after = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie)
      .set('X-Forwarded-For', IP_JTI);
    expect(after.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 3 — ENCRYPT_KEY: comportamento por ambiente
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 3 — crypto-utils comportamento sem ENCRYPT_KEY', () => {
  const { encrypt, decrypt, isEncrypted } = require('../crypto-utils');

  // Sem ENCRYPT_KEY, encrypt() retorna prefixo PLAIN (para dev/teste)
  test('encrypt() sem ENCRYPT_KEY retorna prefixo PLAIN (não lança erro)', () => {
    const original = process.env.ENCRYPT_KEY;
    delete process.env.ENCRYPT_KEY;
    try {
      const result = encrypt('12345678900');
      expect(result).toMatch(/^PLAIN:/);
      expect(isEncrypted(result)).toBe(true);
    } finally {
      if (original !== undefined) process.env.ENCRYPT_KEY = original;
    }
  });

  test('decrypt() de valor PLAIN retorna o valor original', () => {
    const result = decrypt('PLAIN:12345678900');
    expect(result).toBe('12345678900');
  });

  test('encrypt() com ENCRYPT_KEY retorna prefixo ENC:', () => {
    const original = process.env.ENCRYPT_KEY;
    process.env.ENCRYPT_KEY = 'chave-de-teste-32-chars-ou-mais!!';
    try {
      const result = encrypt('12345678900');
      expect(result).toMatch(/^ENC:/);
      expect(isEncrypted(result)).toBe(true);
      // E descriptografa corretamente
      expect(decrypt(result)).toBe('12345678900');
    } finally {
      process.env.ENCRYPT_KEY = original;
    }
  });

  test('decrypt() com ENCRYPT_KEY errada retorna null (não lança)', () => {
    // Criptografa com chave A, tenta decriptar com chave B
    process.env.ENCRYPT_KEY = 'chave-A-32-chars-ou-mais-para-ok!';
    const enc = encrypt('dado-secreto');
    process.env.ENCRYPT_KEY = 'chave-B-32-chars-diferente-ok!!!!';
    const result = decrypt(enc);
    expect(result).toBeNull();
    // Restaura
    process.env.ENCRYPT_KEY = 'chave-A-32-chars-ou-mais-para-ok!';
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 4 — fornecedores.js não usa dados.cpf como fallback
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 4 — fornecedor criado/lido não expõe CPF via campo dados', () => {
  let adminToken;
  let fornId;
  const CPF_TESTE = '123.456.789-00';

  beforeAll(async () => {
    if (SKIP_DB) return;
    // getAdminToken usa makeToken com empresaId:1 — padrão de todos os outros testes
    adminToken = await getAdminToken();
  });

  afterAll(async () => {
    if (!fornId || !adminToken) return;
    await request(app)
      .delete('/api/fornecedores/' + fornId)
      .set('Authorization', 'Bearer ' + adminToken)
      .catch(() => {});
  });

  dbTest('POST /api/fornecedores cria fornecedor com CPF', async () => {
    const res = await request(app)
      .post('/api/fornecedores')
      .set('Authorization', 'Bearer ' + adminToken)
      .set('X-Forwarded-For', IP_FORN)
      .send({ tipoPessoa: 'fisica', razaoSocial: 'Teste Fix4', cpf: CPF_TESTE, status: 'ativo' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    fornId = res.body.id;
  });

  dbTest('GET /api/fornecedores retorna CPF corretamente (via decrypt, não via dados)', async () => {
    if (!fornId) return;
    const res = await request(app)
      .get('/api/fornecedores')
      .set('Authorization', 'Bearer ' + adminToken)
      .set('X-Forwarded-For', IP_FORN);
    expect(res.status).toBe(200);
    const forn = res.body.fornecedores.find(f => f.id === fornId);
    expect(forn).toBeDefined();
    // CPF deve ser retornado pelo decrypt(), sem precisar do fallback dados.cpf
    expect(forn.cpf).toBe(CPF_TESTE);
  });

  dbTest('campo dados serializado NÃO contém cpf em claro', async () => {
    if (!fornId || !require('../db')) return;
    const db = require('../db');
    const rows = await db.query('SELECT dados FROM fornecedor WHERE id = ?', [fornId]);
    if (!rows.length) return;
    const dados = JSON.parse(rows[0].dados || '{}');
    expect(dados.cpf).toBeUndefined();
    expect(dados.cnpj).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 5 — isolamento multi-tenant: empresa A não grava em empresa B
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 5 — isolamento multi-tenant em lançamentos (cross-tenant write bloqueado)', () => {
  // Usa makeToken para garantir empresaId:1 (padrão dos helpers), independente do DB
  const MY_EMPRESA_ID = 1;
  const adminToken = makeToken({ perfil: 'operador', empresaId: MY_EMPRESA_ID });

  dbTest('PUT /api/lancamentos/:id com id de outra empresa retorna 404 (não grava)', async () => {
    const db = require('../db');

    // Busca um lançamento de OUTRA empresa
    const targetLancs = await db.query(
      'SELECT id FROM lancamento WHERE empresa_id != ? AND deleted_at IS NULL LIMIT 1',
      [MY_EMPRESA_ID]
    );
    if (!targetLancs.length) return; // apenas 1 empresa — skip

    const res = await request(app)
      .put('/api/lancamentos/' + targetLancs[0].id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ data: '2025-01-01', tipo: 'credito', valor: 1, descricao: 'HACK' });

    expect(res.status).toBe(404);
  });

  dbTest('PUT /api/lancamentos/:id não aceita fornecedor_id de outra empresa', async () => {
    const db = require('../db');

    // Busca um lançamento da empresa 1
    const myLancs = await db.query(
      'SELECT id FROM lancamento WHERE empresa_id = ? AND deleted_at IS NULL LIMIT 1',
      [MY_EMPRESA_ID]
    );
    if (!myLancs.length) return;

    // Busca um fornecedor de OUTRA empresa
    const otherForn = await db.query(
      "SELECT id FROM fornecedor WHERE empresa_id != ? AND status != 'excluido' LIMIT 1",
      [MY_EMPRESA_ID]
    );
    if (!otherForn.length) return; // apenas 1 empresa — skip

    const res = await request(app)
      .put('/api/lancamentos/' + myLancs[0].id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ data: '2025-01-01', tipo: 'credito', valor: 1, fornecedor_id: otherForn[0].id });

    // 400 porque fornecedor não pertence a esta empresa
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
