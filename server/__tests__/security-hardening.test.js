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
// Fix 3 — Versionamento de chave de criptografia (ENC:v{n}:...)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 3 — Versionamento de chave de criptografia (ENC:v{n}:...)', () => {
  const KEY_A = 'chave-A-para-testes-32bytes-ok!!';
  const KEY_B = 'chave-B-rotacionada-32bytes-ok!!';
  const PLAIN = '123.456.789-00';

  // Guarda estado original das env vars
  let origKey, origVersion, origV1;
  beforeEach(() => {
    origKey     = process.env.ENCRYPT_KEY;
    origVersion = process.env.ENCRYPT_KEY_VERSION;
    origV1      = process.env.ENCRYPT_KEY_V1;
  });
  afterEach(() => {
    if (origKey !== undefined) process.env.ENCRYPT_KEY = origKey; else delete process.env.ENCRYPT_KEY;
    if (origVersion !== undefined) process.env.ENCRYPT_KEY_VERSION = origVersion; else delete process.env.ENCRYPT_KEY_VERSION;
    if (origV1 !== undefined) process.env.ENCRYPT_KEY_V1 = origV1; else delete process.env.ENCRYPT_KEY_V1;
  });

  // Re-importa crypto-utils para refletir env vars alteradas
  function freshUtils() {
    jest.resetModules();
    return require('../crypto-utils');
  }

  test('encrypt() sem ENCRYPT_KEY retorna PLAIN:', () => {
    delete process.env.ENCRYPT_KEY;
    const { encrypt, isEncrypted } = freshUtils();
    const result = encrypt(PLAIN);
    expect(result).toMatch(/^PLAIN:/);
    expect(isEncrypted(result)).toBe(true);
  });

  test('decrypt() de PLAIN: retorna valor original', () => {
    const { decrypt } = freshUtils();
    expect(decrypt('PLAIN:' + PLAIN)).toBe(PLAIN);
  });

  test('encrypt() produz formato versionado ENC:v1:...', () => {
    process.env.ENCRYPT_KEY = KEY_A;
    process.env.ENCRYPT_KEY_VERSION = '1';
    const { encrypt } = freshUtils();
    const result = encrypt(PLAIN);
    expect(result).toMatch(/^ENC:v1:/);
    expect(result.split(':').length).toBe(5); // ENC, v1, iv, tag, cipher
  });

  test('decrypt() de ENC:v1 com chave correta retorna plaintext', () => {
    process.env.ENCRYPT_KEY = KEY_A;
    process.env.ENCRYPT_KEY_VERSION = '1';
    const { encrypt, decrypt } = freshUtils();
    const enc = encrypt(PLAIN);
    expect(decrypt(enc)).toBe(PLAIN);
  });

  test('decrypt() de formato legado (ENC:iv:tag:cipher sem versão) tratado como v1', () => {
    // Simula dado existente no banco no formato antigo
    process.env.ENCRYPT_KEY = KEY_A;
    process.env.ENCRYPT_KEY_VERSION = '1';
    const { decrypt } = freshUtils();
    // Constrói manualmente um valor no formato legado usando módulo crypto diretamente
    const crypto = require('crypto');
    const key    = crypto.createHash('sha256').update(KEY_A).digest();
    const iv     = crypto.randomBytes(12);
    const ciph   = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc    = Buffer.concat([ciph.update(PLAIN, 'utf8'), ciph.final()]);
    const tag    = ciph.getAuthTag();
    const legacy = `ENC:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    expect(decrypt(legacy)).toBe(PLAIN);
  });

  test('decrypt() retorna null com chave errada (não lança)', () => {
    process.env.ENCRYPT_KEY = KEY_A;
    const { encrypt } = freshUtils();
    const enc = encrypt(PLAIN);
    // Troca a chave — decrypt deve retornar null
    process.env.ENCRYPT_KEY = KEY_B;
    const { decrypt } = freshUtils();
    expect(decrypt(enc)).toBeNull();
  });

  test('reEncrypt() não modifica valor já na versão corrente', () => {
    process.env.ENCRYPT_KEY = KEY_A;
    process.env.ENCRYPT_KEY_VERSION = '1';
    const { encrypt, reEncrypt } = freshUtils();
    const enc = encrypt(PLAIN);
    expect(reEncrypt(enc)).toBe(enc); // mesmo objeto — sem re-escrita
  });

  test('reEncrypt() migra legado para versão corrente', () => {
    // Cria legado com v1
    process.env.ENCRYPT_KEY = KEY_A;
    process.env.ENCRYPT_KEY_VERSION = '1';
    const cryptoNode = require('crypto');
    const key = cryptoNode.createHash('sha256').update(KEY_A).digest();
    const iv  = cryptoNode.randomBytes(12);
    const c   = cryptoNode.createCipheriv('aes-256-gcm', key, iv);
    const e   = Buffer.concat([c.update(PLAIN, 'utf8'), c.final()]);
    const t   = c.getAuthTag();
    const legacy = `ENC:${iv.toString('hex')}:${t.toString('hex')}:${e.toString('hex')}`;

    // Rotaciona para v2: antiga chave em ENCRYPT_KEY_V1, nova chave em ENCRYPT_KEY
    process.env.ENCRYPT_KEY_V1      = KEY_A;
    process.env.ENCRYPT_KEY         = KEY_B;
    process.env.ENCRYPT_KEY_VERSION = '2';
    const { decrypt, reEncrypt } = freshUtils();

    const migrated = reEncrypt(legacy);
    expect(migrated).toMatch(/^ENC:v2:/);
    expect(decrypt(migrated)).toBe(PLAIN);
  });

  test('reEncrypt() ENC:v1 → ENC:v2 após rotação com ENCRYPT_KEY_V1', () => {
    // Fase 1: criptografa como v1
    process.env.ENCRYPT_KEY         = KEY_A;
    process.env.ENCRYPT_KEY_VERSION = '1';
    const { encrypt: enc1 } = freshUtils();
    const v1Value = enc1(PLAIN);
    expect(v1Value).toMatch(/^ENC:v1:/);

    // Fase 2: rotaciona para v2
    process.env.ENCRYPT_KEY_V1      = KEY_A;
    process.env.ENCRYPT_KEY         = KEY_B;
    process.env.ENCRYPT_KEY_VERSION = '2';
    const { decrypt: dec2, reEncrypt: re2 } = freshUtils();

    const v2Value = re2(v1Value);
    expect(v2Value).toMatch(/^ENC:v2:/);
    expect(dec2(v2Value)).toBe(PLAIN);
    // v1 ainda descriptografável via ENCRYPT_KEY_V1
    expect(dec2(v1Value)).toBe(PLAIN);
  });

  test('reEncrypt() retorna null se chave histórica não disponível', () => {
    // Dado criptografado com v1 mas ENCRYPT_KEY_V1 não definida
    process.env.ENCRYPT_KEY         = KEY_A;
    process.env.ENCRYPT_KEY_VERSION = '1';
    const { encrypt: enc1 } = freshUtils();
    const v1Value = enc1(PLAIN);

    // Rotaciona sem preservar v1
    delete process.env.ENCRYPT_KEY_V1;
    process.env.ENCRYPT_KEY         = KEY_B;
    process.env.ENCRYPT_KEY_VERSION = '2';
    const { reEncrypt } = freshUtils();
    expect(reEncrypt(v1Value)).toBeNull();
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
