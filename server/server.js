require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const logger = require('./logger');

// ── Camada de usuários/auth com fallback JSON → MySQL ─────────────────────
const usersDb = require('./users-db');

const app = express();

// Basic HTTP hardening — CSP configurado para permitir os scripts do frontend
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr:  ["'none'"],
      styleSrcElem:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      // styleSrcAttr: necessário para os style="" no HTML estático (não há <style> blocos)
      styleSrcAttr:   ["'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc:         ["'self'", "data:"],
      connectSrc:     ["'self'", "http://localhost:3001", "ws://localhost:3001", "https://viacep.com.br"],
      fontSrc:        ["'self'", "https://fonts.gstatic.com"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false
}));

// CORS: origem explícita em produção; em dev apenas localhost
const API_ORIGIN = process.env.API_ORIGIN || null;
const _corsOrigin = API_ORIGIN
  ? API_ORIGIN
  : (process.env.NODE_ENV === 'production' ? false : 'http://localhost:3001');
if (!API_ORIGIN && process.env.NODE_ENV === 'production') {
  logger.warn('API_ORIGIN não definida — CORS bloqueado para todas as origens externas em produção.');
}
app.use(cors({ origin: _corsOrigin, credentials: true }));
app.set('trust proxy', 1); // suporta X-Forwarded-For de proxies/nginx
app.use(bodyParser.json({ limit: '100kb' }));
app.use(cookieParser());

// Rate limiters
const authLimiter    = rateLimit({ windowMs: 60 * 1000, max: 10,  standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Muitas tentativas, aguarde um minuto.' } });
const refreshLimiter = rateLimit({ windowMs: 60 * 1000, max: 30,  standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Taxa excedida.' } });
const writeLimiter   = rateLimit({ windowMs: 60 * 1000, max: 60,  standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Muitas requisições. Aguarde um momento.' } });
const readLimiter    = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Muitas requisições. Aguarde um momento.' } });

// CSRF: valida header Origin em requisições de escrita em produção
function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (process.env.NODE_ENV !== 'production' || !API_ORIGIN) return next();
  const origin = req.headers.origin;
  if (origin && !origin.startsWith(API_ORIGIN)) {
    return res.status(403).json({ ok: false, erro: 'CSRF: origem não autorizada.' });
  }
  next();
}
app.use(csrfCheck);

app.use(logger.requestMiddleware());

const JWT_SECRET      = process.env.JWT_SECRET      || 'dev-secret-change-me';
const JWT_SECRET_PREV = process.env.JWT_SECRET_PREV  || null;

if (!process.env.JWT_SECRET) {
  logger.warn('JWT_SECRET não definido. Usando valor padrão de desenvolvimento. Defina JWT_SECRET no .env para produção.');
} else if (process.env.JWT_SECRET.length < 32) {
  logger.warn(`JWT_SECRET curto (${process.env.JWT_SECRET.length} chars). Use pelo menos 32 caracteres aleatórios.`);
}
if (JWT_SECRET_PREV && JWT_SECRET_PREV === JWT_SECRET) {
  logger.warn('JWT_SECRET_PREV igual a JWT_SECRET — a chave anterior deve ser diferente da atual.');
}

const JWT_EXP = process.env.JWT_EXP || '30m';
const COOKIE_SECURE = (process.env.NODE_ENV === 'production') || (process.env.COOKIE_SECURE === 'true');

// ── Blacklist de tokens revogados (logout real) ───────────────────────────
// L1: Map em memória (lookup O(1)). L2: tabela revoked_token no banco.
// Ao reiniciar o servidor, os JTIs são recarregados do banco para o Map.
const revokedTokens = new Map();

// Persiste um JTI revogado no Map e no banco (async, não bloqueia o handler).
async function revokeJti(jti, expiresAtMs) {
  revokedTokens.set(jti, expiresAtMs);
  if (!db) return;
  try {
    await db.execute(
      'INSERT IGNORE INTO revoked_token (jti, expires_at) VALUES (?, ?)',
      [jti, new Date(expiresAtMs)]
    );
  } catch (e) {
    logger.warn('[auth] Falha ao persistir JTI revogado no banco', { err: e && e.message });
  }
}

// Recarrega JTIs ainda válidos do banco para o Map (chamado no startup).
async function loadRevokedJtis() {
  if (!db) return;
  try {
    const rows = await db.query(
      'SELECT jti, expires_at FROM revoked_token WHERE expires_at > NOW()'
    );
    for (const r of rows) revokedTokens.set(r.jti, new Date(r.expires_at).getTime());
    if (rows.length > 0) logger.info(`[auth] ${rows.length} JTI(s) revogado(s) recarregado(s) do banco`);
  } catch (e) {
    logger.warn('[auth] Falha ao carregar JTIs revogados do banco', { err: e && e.message });
  }
}

// Limpeza periódica: expira entradas do Map e da tabela no banco.
setInterval(async () => {
  const now = Date.now();
  for (const [jti, exp] of revokedTokens) if (exp < now) revokedTokens.delete(jti);
  if (db) {
    try { await db.execute('DELETE FROM revoked_token WHERE expires_at <= NOW()'); }
    catch (e) { /* silencia — não crítico */ }
  }
}, 5 * 60 * 1000).unref();

// ── Helpers compartilhados ────────────────────────────────────────────────

function audit(req, action, entityType, entityId, detail = null) {
  const actorId = req.user ? req.user.userId : null;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = (req.headers['user-agent'] || '').slice(0, 500);
  return usersDb.appendAudit(action, actorId, { entityType, entityId: entityId ? String(entityId) : null, detail, ip, userAgent });
}

// JWT middleware — aceita Bearer header OU cookie httpOnly (auth_token)
// Suporta rotação de chave via JWT_SECRET_PREV: tokens antigos continuam válidos
// durante a transição enquanto novos tokens são emitidos com JWT_SECRET.
function jwtMiddleware(req, res, next) {
  let token = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) token = h.slice(7);
  if (!token && req.cookies && req.cookies.auth_token) token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ ok:false, erro:'Unauthorized' });

  const secrets = [JWT_SECRET];
  if (JWT_SECRET_PREV && JWT_SECRET_PREV !== JWT_SECRET) secrets.push(JWT_SECRET_PREV);

  for (const secret of secrets) {
    try {
      const payload = jwt.verify(token, secret);
      if (payload.jti && revokedTokens.has(payload.jti)) {
        return res.status(401).json({ ok:false, erro:'Unauthorized' });
      }
      req.user = payload;
      return next();
    } catch(e) { /* tenta próxima chave */ }
  }
  return res.status(401).json({ ok:false, erro:'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.perfil !== 'admin') return res.status(403).json({ ok:false, erro:'Forbidden' });
  next();
}

// Hierarquia: superadmin > admin > gerente > operador > visualizador
const ROLE_RANK = { superadmin: 5, admin: 4, gerente: 3, operador: 2, visualizador: 1 };
function requireRole(minRole) {
  return (req, res, next) => {
    const rank = ROLE_RANK[req.user?.perfil] || 0;
    if (rank < (ROLE_RANK[minRole] || 99)) {
      return res.status(403).json({ ok:false, erro:'Forbidden — perfil insuficiente' });
    }
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.perfil !== 'superadmin') return res.status(403).json({ ok:false, erro:'Forbidden — superadmin only' });
  next();
}

// Corrige double-encoding (UTF-8 bytes gravados como latin1/cp1252)
const CP1252_TO_BYTE = {};
[[0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],
 [0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02C6,0x88],
 [0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],
 [0x017D,0x8E],[0x2018,0x91],[0x2019,0x92],[0x201C,0x93],
 [0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],
 [0x02DC,0x98],[0x2122,0x99],[0x0161,0x9A],[0x203A,0x9B],
 [0x0153,0x9C],[0x017E,0x9E],[0x0178,0x9F]].forEach(function(p){
  CP1252_TO_BYTE[String.fromCharCode(p[0])] = p[1];
});
const CP1252_CHARS = Object.keys(CP1252_TO_BYTE);
function _decodeMojibake(str) {
  if (typeof str !== 'string') return str;
  var triggered = CP1252_CHARS.some(function(c) { return str.indexOf(c) >= 0; });
  if (!triggered) { for (var i=0; i<str.length; i++) { var cc=str.charCodeAt(i); if (cc>=0x80&&cc<=0x9F){triggered=true;break;} } }
  if (!triggered) return str;
  try {
    var bytes = [];
    for (var j=0; j<str.length; j++) {
      var ch=str[j], cp=str.charCodeAt(j);
      if (cp<=0x7F)                            { bytes.push(cp); }
      else if (cp>=0x80&&cp<=0x9F)             { bytes.push(cp); }
      else if (CP1252_TO_BYTE[ch]!==undefined) { bytes.push(CP1252_TO_BYTE[ch]); }
      else if (cp>=0xA0&&cp<=0xFF)             { bytes.push(cp); }
      else                                      { bytes.push(0x3F); }
    }
    return Buffer.from(bytes).toString('utf8');
  } catch(e) { return str; }
}

// ── Frontend estático ─────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const CLIENT_ROOT = path.join(__dirname, '..');

// Bloqueio de segurança: impede acesso HTTP a diretórios e arquivos sensíveis
// que ficam na raiz do projeto junto com os assets do frontend.
// Usa 404 (não 403) para não revelar se o arquivo existe.
const _BLOCKED_PREFIXES = ['/server/', '/db/', '/legacy/', '/config/'];
const _BLOCKED_FILES = new Set([
  '/package.json', '/package-lock.json',
  '/readme.md', '/improvements.md',
  '/dockerfile', '/railway.json', '/railway.toml',
  '/start_all.bat', '/.env',
]);
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (_BLOCKED_PREFIXES.some(pre => p === pre.slice(0, -1) || p.startsWith(pre))) {
    return res.status(404).end();
  }
  if (_BLOCKED_FILES.has(p)) {
    return res.status(404).end();
  }
  // Bloqueia qualquer arquivo .sql, .log, .bat, .json fora de /client/
  if (!p.startsWith('/client/') && /\.(sql|log|bat|env)$/.test(p)) {
    return res.status(404).end();
  }
  next();
});

try {
  app.use(express.static(CLIENT_ROOT, { dotfiles: 'deny' }));
  logger.info('Servindo frontend estático', { path: CLIENT_ROOT });
} catch(e) {
  logger.warn('Não foi possível servir arquivos estáticos', { err: e && e.message });
}

// ── Banco de dados ────────────────────────────────────────────────────────

const db = (() => {
  try { return require('./db'); } catch(e) { logger.warn('DB helper indisponível', { err: e && e.message }); return null; }
})();

// ── Migrações versionadas ─────────────────────────────────────────────────
// Promise exportada como app.migrationsReady — testes aguardam no beforeAll.
const { runMigrations } = require('./migrations/runner');
const MIGRATIONS = [
  require('./migrations/001_core_tables'),
  require('./migrations/002_alter_columns_indexes'),
  require('./migrations/003_optional_tables'),
  require('./migrations/004_purge_unhashed_tokens'),
];
const migrationsReady = runMigrations(db, logger, MIGRATIONS)
  .catch(e => logger.warn('Migrações falharam', { err: e && e.message }));

// ── Rotas da API ──────────────────────────────────────────────────────────

const cryptoUtils = require('./crypto-utils');

// ── Repositórios (injetados nas rotas) ────────────────────────────────────
const createContasRepo       = require('./repositories/contas.repo');
const createLancamentosRepo  = require('./repositories/lancamentos.repo');
const createFornecedoresRepo = require('./repositories/fornecedores.repo');
const createRecibosRepo      = require('./repositories/recibos.repo');

const contasRepo       = db ? createContasRepo({ db, logger })       : null;
const lancamentosRepo  = db ? createLancamentosRepo({ db, logger })  : null;
const fornecedoresRepo = db ? createFornecedoresRepo({ db, logger }) : null;
const recibosRepo      = db ? createRecibosRepo({ db, logger })      : null;

// ── Validação de ENCRYPT_KEY ──────────────────────────────────────────────
if (!process.env.ENCRYPT_KEY) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('[SECURITY] ENCRYPT_KEY não definida em produção. Configure ENCRYPT_KEY no ambiente antes de iniciar o servidor.');
    process.exit(1);
  } else {
    logger.warn('ENCRYPT_KEY não definida — CPF/CNPJ serão armazenados com prefixo PLAIN. Defina ENCRYPT_KEY no .env para criptografia real.');
  }
} else {
  const keyVersion = parseInt(process.env.ENCRYPT_KEY_VERSION || '1', 10);
  logger.info(`[crypto] ENCRYPT_KEY ativa na versão v${keyVersion}.`);
  // Avisa se não existe a chave da versão anterior definida (risco de dados inacessíveis após rotação)
  if (keyVersion > 1 && !process.env[`ENCRYPT_KEY_V${keyVersion - 1}`]) {
    logger.warn(`[crypto] ENCRYPT_KEY_VERSION=${keyVersion} mas ENCRYPT_KEY_V${keyVersion - 1} não está definida. Dados criptografados com a chave v${keyVersion - 1} ficarão inacessíveis.`);
  }
}

const deps = {
  db, logger, audit, Joi, bcrypt, jwt, usersDb,
  JWT_SECRET, JWT_SECRET_PREV, JWT_EXP, COOKIE_SECURE,
  jwtMiddleware, requireAdmin, requireRole, requireSuperAdmin,
  readLimiter, writeLimiter, authLimiter, refreshLimiter,
  _decodeMojibake, cryptoUtils, revokedTokens, revokeJti,
  contasRepo, lancamentosRepo, fornecedoresRepo, recibosRepo,
};

// Health check — para monitoramento/liveness probe
app.get('/health', (req, res) => res.json({ ok: true, uptime: Math.floor(process.uptime()) }));

app.use('/api', require('./routes/auth')(deps));
app.use('/api', require('./routes/users')(deps));
app.use('/api', require('./routes/empresas')(deps));
app.use('/api', require('./routes/contas')(deps));
app.use('/api', require('./routes/lancamentos')(deps));
app.use('/api', require('./routes/fornecedores')(deps));
app.use('/api', require('./routes/recibos')(deps));

// ── Exports e error handler ───────────────────────────────────────────────

module.exports = app;
module.exports.migrationsReady = migrationsReady;
// Exportados para testes de segurança (JTI persistence)
module.exports.revokedTokens   = revokedTokens;
module.exports.loadRevokedJtis = loadRevokedJtis;

// Middleware global de erro — deve ficar após todas as rotas
app.use((err, req, res, _next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  logger.error('Erro não tratado', { err: err && err.message, stack: !isProduction ? err && err.stack : undefined });
  if (res.headersSent) return;
  res.status(err.status || 500).json({
    ok: false,
    erro: isProduction ? 'Erro interno do servidor.' : (err.message || 'Erro interno.')
  });
});

// Só fazer listen quando executado diretamente (não via require)
// ── Purge de retenção de dados (LGPD) ────────────────────────────────────
async function _runRetentionCleanup() {
  if (!db) return;
  try {
    const [r1] = await db.pool.query("DELETE FROM lancamento WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL 90 DAY)");
    const [r2] = await db.pool.query("DELETE FROM conta      WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL 90 DAY)");
    const [r3] = await db.pool.query("DELETE FROM audit_log  WHERE `when` < DATE_SUB(NOW(), INTERVAL 1 YEAR)");
    const [r4] = await db.pool.query("DELETE FROM refresh_token WHERE expires_at < NOW()");
    const total = (r1.affectedRows||0) + (r2.affectedRows||0) + (r3.affectedRows||0) + (r4.affectedRows||0);
    if (total > 0) logger.info('[retention] Purge concluído', { lancamentos: r1.affectedRows, contas: r2.affectedRows, auditLog: r3.affectedRows, tokens: r4.affectedRows });
  } catch(e) { logger.warn('[retention] Purge falhou', { err: e && e.message }); }
}

// ── Migração de CPF/CNPJ para formato criptografado ───────────────────────
async function _migrateEncryptCpf() {
  if (!db) return;
  const { encrypt, isEncrypted } = cryptoUtils;
  try {
    const forns = await db.query('SELECT id, cpf, cnpj, dados FROM fornecedor WHERE cpf IS NOT NULL OR cnpj IS NOT NULL');
    for (const f of forns) {
      const updates = {};
      if (f.cpf  && !isEncrypted(f.cpf))  updates.cpf  = encrypt(f.cpf);
      if (f.cnpj && !isEncrypted(f.cnpj)) updates.cnpj = encrypt(f.cnpj);
      try {
        const dadosObj = JSON.parse(f.dados || '{}');
        if (dadosObj.cpf || dadosObj.cnpj) {
          delete dadosObj.cpf; delete dadosObj.cnpj;
          updates.dados = JSON.stringify(dadosObj);
        }
      } catch { /* dados corrompido — ignora */ }
      if (Object.keys(updates).length > 0) await db.pool.query('UPDATE fornecedor SET ? WHERE id = ?', [updates, f.id]);
    }
    const recibos = await db.query('SELECT id, fornecedor_cpf FROM recibo WHERE fornecedor_cpf IS NOT NULL');
    for (const r of recibos) {
      if (r.fornecedor_cpf && !isEncrypted(r.fornecedor_cpf)) {
        await db.pool.query('UPDATE recibo SET fornecedor_cpf = ? WHERE id = ?', [encrypt(r.fornecedor_cpf), r.id]);
      }
    }
    logger.info('[crypto] Migração de CPF/CNPJ concluída');
  } catch(e) { logger.warn('[crypto] Migração de CPF/CNPJ falhou', { err: e && e.message }); }
}

if (require.main === module) {
  (async () => {
    try {
      const pool = db && db.pool ? db.pool : null;
      await usersDb.init(pool);
      const defaultEmpresaId = await usersDb.ensureDefaultEmpresa();
      await usersDb.ensureAdmin(defaultEmpresaId);
    } catch(e) { console.error('usersDb init error:', e.message); }
    const server = app.listen(PORT, () => logger.info('Servidor iniciado', { url: 'http://localhost:' + PORT }));
    server.on('error', (e) => logger.error('Erro no servidor HTTP', { err: e.message }));
    process.on('uncaughtException', (e) => logger.error('Exceção não tratada', { err: e.message, stack: e.stack }));
    process.on('unhandledRejection', (e) => logger.error('Promise rejeitada sem tratamento', { err: e && e.message }));
    // Tarefas assíncronas pós-startup (não bloqueiam o servidor)
    migrationsReady.then(() => {
      loadRevokedJtis();       // Recarrega JTIs revogados do banco para o Map
      _runRetentionCleanup();
      _migrateEncryptCpf();
    });
  })();
}
