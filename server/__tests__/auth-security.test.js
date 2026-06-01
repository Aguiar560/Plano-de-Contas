'use strict';

/**
 * auth-security.test.js — Testes de segurança avançados:
 *  - Bloqueio de conta após N tentativas falhas
 *  - Logout real via revogação de JTI (blacklist em memória)
 *  - Rotação de refresh token (token antigo inválido após uso)
 *  - Comportamento com refresh token inválido/expirado
 */

const request = require('supertest');
const { app, getAdminToken, makeToken, ADMIN } = require('./helpers');

// Cada grupo usa um IP falso diferente para não acionar o rate limiter compartilhado
const IP = {
  lockout:    '10.0.1.1',
  logout:     '10.0.1.2',
  refresh:    '10.0.1.3',
  validation: '10.0.1.4',
  jti:        '10.0.1.5',
};
const withIp = (ip) => (req) => req.set('X-Forwarded-For', ip);

const SKIP_DB = process.env.SKIP_DB_TESTS === 'true';
const dbTest  = SKIP_DB ? test.skip : test;

// ── Bloqueio de conta ─────────────────────────────────────────────────────

describe('Bloqueio de conta após falhas de login', () => {
  const USUARIO_LOCK = 'locktest' + Date.now().toString().slice(-6);
  let adminToken;
  let userId;

  beforeAll(async () => {
    if (SKIP_DB) return;
    adminToken = await getAdminToken();
    // Cria usuário de teste
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ usuario: USUARIO_LOCK, nome: 'Lock Test', senha: 'senha123', perfil: 'visualizador' });
    userId = res.body.user?.id;
  });

  afterAll(async () => {
    if (!userId || !adminToken) return;
    // Remove usuário de teste
    await request(app)
      .delete('/api/users/' + userId)
      .set('Authorization', 'Bearer ' + adminToken)
      .catch(() => {});
  });

  dbTest('após 5 tentativas erradas, conta é bloqueada', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/login')
        .set('X-Forwarded-For', IP.lockout)
        .send({ usuario: USUARIO_LOCK, senha: 'senha_errada_' + i });
    }
    const res = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.lockout)
      .send({ usuario: USUARIO_LOCK, senha: 'senha123' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  dbTest('admin pode desbloquear a conta', async () => {
    if (!userId) return;
    const unlock = await request(app)
      .post(`/api/users/${userId}/unlock`)
      .set('Authorization', 'Bearer ' + adminToken);
    expect(unlock.status).toBe(200);
    expect(unlock.body.ok).toBe(true);

    const login = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.lockout)
      .send({ usuario: USUARIO_LOCK, senha: 'senha123' });
    expect(login.status).toBe(200);
    expect(login.body.ok).toBe(true);
  });

  test('mensagem de erro é idêntica para usuário inexistente vs senha errada (não vaza info)', async () => {
    const [r1, r2] = await Promise.all([
      request(app).post('/api/login').set('X-Forwarded-For', IP.lockout).send({ usuario: 'nao_existe_xyz', senha: 'abc' }),
      request(app).post('/api/login').set('X-Forwarded-For', IP.lockout).send({ usuario: ADMIN.usuario, senha: 'senha_totalmente_errada' }),
    ]);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r1.body.erro).toBe(r2.body.erro);
  });
});

// ── Logout real (revogação de JTI) ────────────────────────────────────────

describe('Logout real via revogação JTI', () => {
  dbTest('token revogado após logout é rejeitado imediatamente', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.logout)
      .send({ usuario: ADMIN.usuario, senha: ADMIN.senha });
    expect(loginRes.status).toBe(200);

    const cookies = loginRes.headers['set-cookie'];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toBeDefined();

    // 2. Token funciona antes do logout
    const before = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie);
    expect(before.status).toBe(200);

    // 3. Logout
    const logout = await request(app)
      .post('/api/logout')
      .set('Cookie', authCookie);
    expect(logout.status).toBe(200);

    // 4. Mesmo token é rejeitado após logout (JTI na blacklist)
    const after = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie);
    expect(after.status).toBe(401);
  });
});

// ── Rotação de refresh token ───────────────────────────────────────────────

describe('Rotação de refresh token', () => {
  dbTest('refresh token é rotacionado: token antigo fica inválido após uso', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.refresh)
      .send({ usuario: ADMIN.usuario, senha: ADMIN.senha });
    expect(loginRes.status).toBe(200);

    const setCookies = loginRes.headers['set-cookie'] || [];
    const refreshCookie = setCookies.find(c => c.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();

    // 2. Usa o refresh token → gera novo access + novo refresh
    const refresh1 = await request(app)
      .post('/api/refresh')
      .set('Cookie', refreshCookie);
    expect(refresh1.status).toBe(200);

    // 3. Tenta usar o refresh token ORIGINAL de novo → deve ser inválido (rotacionado)
    const refresh2 = await request(app)
      .post('/api/refresh')
      .set('Cookie', refreshCookie);
    expect(refresh2.status).toBe(401);
  });

  test('sem refresh token retorna 401', async () => {
    const res = await request(app).post('/api/refresh');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('refresh token malformado retorna 401', async () => {
    const res = await request(app)
      .post('/api/refresh')
      .set('Cookie', 'refresh_token=token_invalido_qualquer');
    expect(res.status).toBe(401);
  });
});

// ── Validação de campos no login ──────────────────────────────────────────

describe('Validação de campos no login', () => {
  test('usuário ausente retorna 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.validation)
      .send({ senha: 'abc123' });
    expect(res.status).toBe(400);
  });

  test('senha ausente retorna 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.validation)
      .send({ usuario: 'admin' });
    expect(res.status).toBe(400);
  });

  test('body vazio retorna 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.validation)
      .send({});
    expect(res.status).toBe(400);
  });

  test('campos em branco retornam 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.validation)
      .send({ usuario: '', senha: '' });
    expect(res.status).toBe(400);
  });
});

// ── Token com jti ─────────────────────────────────────────────────────────

describe('JWT com jti', () => {
  dbTest('JWT emitido no login contém campo jti', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', IP.jti)
      .send({ usuario: ADMIN.usuario, senha: ADMIN.senha });
    expect(loginRes.status).toBe(200);

    const cookies = loginRes.headers['set-cookie'] || [];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    const token = authCookie?.split(';')[0].replace('auth_token=', '');
    expect(token).toBeDefined();

    // Decodifica payload sem verificar (apenas inspeção)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
  });
});
