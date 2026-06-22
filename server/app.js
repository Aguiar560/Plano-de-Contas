require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const Joi        = require('joi');
const logger     = require('./logger');
const cfg        = require('./config');
const usersDb    = require('./users-db');

const app = express();

// ── Segurança HTTP ────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr:  ["'none'"],
      styleSrcElem:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
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

const API_ORIGIN  = process.env.API_ORIGIN || null;
const _corsOrigin = API_ORIGIN
  ? API_ORIGIN
  : (process.env.NODE_ENV === 'production' ? false : 'http://localhost:3001');
if (!API_ORIGIN && process.env.NODE_ENV === 'production') {
  logger.warn('API_ORIGIN não definida — CORS bloqueado para todas as origens externas em produção.');
}
app.use(cors({ origin: _corsOrigin, credentials: true }));
app.set('trust proxy', 1);
app.use(bodyParser.json({ limit: '100kb' }));
app.use(cookieParser());

// ── Rate limiters ─────────────────────────────────────────────────────────

const authLimiter    = rateLimit({ ...cfg.rateLimit.auth,    standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Muitas tentativas, aguarde um minuto.' } });
const refreshLimiter = rateLimit({ ...cfg.rateLimit.refresh, standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Taxa excedida.' } });
const writeLimiter   = rateLimit({ ...cfg.rateLimit.write,   standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Muitas requisições. Aguarde um momento.' } });
const readLimiter    = rateLimit({ ...cfg.rateLimit.read,    standardHeaders: true, legacyHeaders: false, message: { ok:false, erro:'Muitas requisições. Aguarde um momento.' } });

// ── CSRF ──────────────────────────────────────────────────────────────────

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

// ── JWT ───────────────────────────────────────────────────────────────────

const JWT_SECRET      = process.env.JWT_SECRET      || 'dev-secret-change-me';
const JWT_SECRET_PREV = process.env.JWT_SECRET_PREV  || null;
const JWT_EXP         = process.env.JWT_EXP          || '30m';
const COOKIE_SECURE   = (process.env.NODE_ENV === 'production') || (process.env.COOKIE_SECURE === 'true');

if (!process.env.JWT_SECRET) {
  logger.warn('JWT_SECRET não definido. Usando valor padrão de desenvolvimento.');
} else if (process.env.JWT_SECRET.length < 32) {
  logger.warn(`JWT_SECRET curto (${process.env.JWT_SECRET.length} chars). Use pelo menos 32 caracteres aleatórios.`);
}
if (JWT_SECRET_PREV && JWT_SECRET_PREV === JWT_SECRET) {
  logger.warn('JWT_SECRET_PREV igual a JWT_SECRET — a chave anterior deve ser diferente da atual.');
}

// ── Blacklist JTI — L1: Map em memória, L2: tabela revoked_token ─────────

const revokedTokens = new Map();

async function revokeJti(jti, expiresAtMs) {
  revokedTokens.set(jti, expiresAtMs);
  if (!db) return;
  try {
    await db.execute(
      'INSERT IGNORE INTO revoked_token (jti, expires_at) VALUES (?, ?)',
      [jti, new Date(expiresAtMs)]
    );
  } catch(e) {
    logger.warn('[auth] Falha ao persistir JTI revogado no banco', { err: e && e.message });
  }
}

async function loadRevokedJtis() {
  if (!db) return;
  try {
    const rows = await db.query('SELECT jti, expires_at FROM revoked_token WHERE expires_at > NOW()');
    for (const r of rows) revokedTokens.set(r.jti, new Date(r.expires_at).getTime());
    if (rows.length > 0) logger.info(`[auth] ${rows.length} JTI(s) revogado(s) recarregado(s) do banco`);
  } catch(e) {
    logger.warn('[auth] Falha ao carregar JTIs revogados do banco', { err: e && e.message });
  }
}

// ── Helpers de autenticação ───────────────────────────────────────────────

function audit(req, action, entityType, entityId, detail = null) {
  const actorId  = req.user ? req.user.userId : null;
  const ip       = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = (req.headers['user-agent'] || '').slice(0, 500);
  return usersDb.appendAudit(action, actorId, { entityType, entityId: entityId ? String(entityId) : null, detail, ip, userAgent });
}

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

// ── Correção de encoding mojibake ─────────────────────────────────────────

const CP1252_TO_BYTE = {};
[[0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],
 [0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02C6,0x88],
 [0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],
 [0x017D,0x8E],[0x2018,0x91],[0x2019,0x92],[0x201C,0x93],
 [0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],
 [0x02DC,0x98],[0x2122,0x99],[0x0161,0x9A],[0x203A,0x9B],
 [0x0153,0x9C],[0x017E,0x9E],[0x0178,0x9F]].forEach(function(p) {
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

const PORT        = process.env.PORT || 3000;
const CLIENT_ROOT = path.join(__dirname, '..');

const _BLOCKED_PREFIXES = ['/server/', '/db/', '/legacy/', '/config/'];
const _BLOCKED_FILES = new Set([
  '/package.json', '/package-lock.json',
  '/readme.md', '/improvements.md',
  '/dockerfile', '/railway.json', '/railway.toml',
  '/start_all.bat', '/.env',
]);
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (_BLOCKED_PREFIXES.some(pre => p === pre.slice(0, -1) || p.startsWith(pre))) return res.status(404).end();
  if (_BLOCKED_FILES.has(p)) return res.status(404).end();
  if (!p.startsWith('/client/') && /\.(sql|log|bat|env)$/.test(p)) return res.status(404).end();
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

const { runMigrations } = require('./migrations/runner');
const MIGRATIONS = [
  require('./migrations/001_core_tables'),
  require('./migrations/002_alter_columns_indexes'),
  require('./migrations/003_optional_tables'),
  require('./migrations/004_purge_unhashed_tokens'),
  require('./migrations/005_ofx_fitid'),
];
const migrationsReady = runMigrations(db, logger, MIGRATIONS)
  .catch(e => logger.warn('Migrações falharam', { err: e && e.message }));

// ── Validação ENCRYPT_KEY ─────────────────────────────────────────────────

const cryptoUtils = require('./crypto-utils');

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
  if (keyVersion > 1 && !process.env[`ENCRYPT_KEY_V${keyVersion - 1}`]) {
    logger.warn(`[crypto] ENCRYPT_KEY_VERSION=${keyVersion} mas ENCRYPT_KEY_V${keyVersion - 1} não está definida. Dados criptografados com a chave v${keyVersion - 1} ficarão inacessíveis.`);
  }
}

// ── Repositórios ──────────────────────────────────────────────────────────

const createContasRepo       = require('./repositories/contas.repo');
const createLancamentosRepo  = require('./repositories/lancamentos.repo');
const createFornecedoresRepo = require('./repositories/fornecedores.repo');
const createRecibosRepo      = require('./repositories/recibos.repo');

const contasRepo       = db ? createContasRepo({ db, logger })       : null;
const lancamentosRepo  = db ? createLancamentosRepo({ db, logger })  : null;
const fornecedoresRepo = db ? createFornecedoresRepo({ db, logger }) : null;
const recibosRepo      = db ? createRecibosRepo({ db, logger })      : null;

// ── Deps injetados nas rotas ──────────────────────────────────────────────

const deps = {
  db, logger, audit, Joi, bcrypt, jwt, usersDb,
  JWT_SECRET, JWT_SECRET_PREV, JWT_EXP, COOKIE_SECURE,
  jwtMiddleware, requireAdmin, requireRole, requireSuperAdmin,
  readLimiter, writeLimiter, authLimiter, refreshLimiter,
  _decodeMojibake, cryptoUtils, revokedTokens, revokeJti,
  contasRepo, lancamentosRepo, fornecedoresRepo, recibosRepo,
};

// ── Health check — deep probe (DB + uptime) ───────────────────────────────

app.get('/health', async (req, res) => {
  const payload = { ok: true, uptime: Math.floor(process.uptime()) };
  if (db) {
    try {
      await db.execute('SELECT 1');
      payload.db = 'ok';
    } catch(e) {
      payload.ok = false;
      payload.db = 'error';
      return res.status(503).json(payload);
    }
  }
  res.json(payload);
});

// ── OpenAPI / Swagger UI ──────────────────────────────────────────────────

try {
  const swaggerUi   = require('swagger-ui-express');
  const openapiSpec = require('./openapi');
  app.get('/api/openapi.json', (req, res) => res.json(openapiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'Plano de Contas API',
    swaggerOptions: { persistAuthorization: true },
  }));
  logger.info('Swagger UI disponível em /api/docs');
} catch(e) {
  logger.warn('swagger-ui-express indisponível — /api/docs desabilitado', { err: e && e.message });
}

// ── Rotas — /api (legacy) e /api/v1 (versão atual) ───────────────────────

const _authRouter        = require('./routes/auth')(deps);
const _usersRouter       = require('./routes/users')(deps);
const _empresasRouter    = require('./routes/empresas')(deps);
const _contasRouter      = require('./routes/contas')(deps);
const _lancamentosRouter = require('./routes/lancamentos')(deps);
const _fornecedoresRouter = require('./routes/fornecedores')(deps);
const _recibosRouter     = require('./routes/recibos')(deps);

for (const prefix of ['/api', '/api/v1']) {
  app.use(prefix, _authRouter);
  app.use(prefix, _usersRouter);
  app.use(prefix, _empresasRouter);
  app.use(prefix, _contasRouter);
  app.use(prefix, _lancamentosRouter);
  app.use(prefix, _fornecedoresRouter);
  app.use(prefix, _recibosRouter);
}

// ── Error handler global ──────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  const isProd = process.env.NODE_ENV === 'production';
  logger.error('Erro não tratado', { err: err && err.message, stack: !isProd ? err && err.stack : undefined });
  if (res.headersSent) return;
  res.status(err.status || 500).json({
    ok: false,
    erro: isProd ? 'Erro interno do servidor.' : (err.message || 'Erro interno.'),
  });
});

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = app;
module.exports.migrationsReady = migrationsReady;
module.exports.revokedTokens   = revokedTokens;
module.exports.loadRevokedJtis = loadRevokedJtis;

// Exportações internas para server.js (startup) — prefixadas com _ para indicar uso interno
module.exports._db          = db;
module.exports._usersDb     = usersDb;
module.exports._cryptoUtils = cryptoUtils;
module.exports._cfg         = cfg;
module.exports._logger      = logger;
module.exports._PORT        = PORT;
