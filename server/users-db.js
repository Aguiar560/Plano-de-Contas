'use strict';

/**
 * users-db.js — Facade de acesso a dados de usuários.
 *
 * Delega SQL para UsersRepo (server/repositories/users.repo.js) e
 * setup/migração para UserMigrationService (server/services/user-migration.service.js).
 * Mantém fallback JSON para ambientes sem banco (dev sem MySQL configurado).
 *
 * Exports idênticos à versão anterior — zero breaking changes.
 */

const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const cfg      = require('./config');
const createUsersRepo   = require('./repositories/users.repo');
const migrationService  = require('./services/user-migration.service');

// ── Estado interno ────────────────────────────────────────────────────────
let _pool = null;
let _repo = null;

// ── Arquivos de fallback JSON ─────────────────────────────────────────────
const USERS_FILE   = path.join(__dirname, 'users.json');
const REFRESH_FILE = path.join(__dirname, 'refresh_tokens.json');
const AUDIT_FILE   = path.join(__dirname, 'audit.json');

function _loadJson()        { try { return JSON.parse(fs.readFileSync(USERS_FILE,   'utf8')); } catch(e) { return []; } }
function _saveJson(u)       { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
function _loadRefreshJson() { try { return JSON.parse(fs.readFileSync(REFRESH_FILE, 'utf8')); } catch(e) { return {}; } }
function _saveRefreshJson(o){ try { fs.writeFileSync(REFRESH_FILE, JSON.stringify(o, null, 2)); } catch(e) {} }

function _mapJsonUser(u) {
  return {
    id: u.id, empresaId: u.empresaId || null, usuario: u.usuario,
    nome: u.nome, perfil: u.perfil, ativo: u.ativo !== false, lockUntil: u.lockUntil || null,
  };
}

// ── Inicialização ─────────────────────────────────────────────────────────

async function init(pool) {
  _pool = pool;
  _repo = pool ? createUsersRepo(pool) : null;
  await migrationService.ensureTables(pool);
  await migrationService.migrateFromJson(pool);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function ensureDefaultEmpresa() {
  if (!_pool) return 1;
  const [[{ cnt }]] = await _pool.execute('SELECT COUNT(1) AS cnt FROM empresa WHERE id = 1');
  if (cnt === 0) {
    await _pool.execute(
      "INSERT INTO empresa (id, nome, slug, plano, ativo, created_at) VALUES (1,'Empresa Padrão','default','basico',1,NOW())"
    );
  }
  await _pool.execute(
    "UPDATE usuario SET empresa_id = 1 WHERE empresa_id IS NULL AND perfil != 'superadmin'"
  ).catch(() => {});
  return 1;
}

async function ensureAdmin(empresaId = 1) {
  if (!_pool) { return _ensureAdminJson(); }
  const [sa] = await _pool.execute(
    "SELECT id FROM usuario WHERE usuario = 'superadmin' AND empresa_id IS NULL LIMIT 1"
  );
  if (sa.length === 0) {
    const hash = bcrypt.hashSync('superadmin', 10);
    await _pool.execute(
      "INSERT INTO usuario (empresa_id, usuario, nome, senha_hash, perfil, ativo, created_at) VALUES (NULL,?,?,?,?,1,NOW())",
      ['superadmin', 'Super Administrador', hash, 'superadmin']
    );
    console.log('Default superadmin created (usuario=superadmin, senha=superadmin) — TROQUE IMEDIATAMENTE');
  }
  const [rows] = await _pool.execute(
    'SELECT id FROM usuario WHERE usuario = ? AND empresa_id = ? LIMIT 1', ['admin', empresaId]
  );
  if (rows.length === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    await _pool.execute(
      "INSERT INTO usuario (empresa_id, usuario, nome, senha_hash, perfil, ativo, created_at) VALUES (?,?,?,?,?,1,NOW())",
      [empresaId, 'admin', 'Administrador', hash, 'admin']
    );
    console.log(`Default admin created for empresa ${empresaId} (usuario=admin, senha=admin)`);
  }
}

function _ensureAdminJson() {
  const users = _loadJson();
  if (!users.find(u => u.usuario === 'admin')) {
    const hash = bcrypt.hashSync('admin', 10);
    users.push({ id: 1, usuario: 'admin', nome: 'Administrador', senhaHash: hash, perfil: 'admin', ativo: true });
    _saveJson(users);
    console.log('Default admin created (usuario=admin, senha=admin) [fallback JSON]');
  }
}

// ── CRUD usuários ─────────────────────────────────────────────────────────

async function findByUsuario(usuario, empresaId) {
  if (!_repo) return _loadJson().find(u => u.usuario.toLowerCase() === usuario.toLowerCase()) || null;
  return _repo.findByUsuario(usuario, empresaId);
}

async function findById(id) {
  if (!_repo) return _loadJson().find(u => u.id === id) || null;
  return _repo.findById(id);
}

async function listAll(empresaId) {
  if (!_repo) return _loadJson().map(_mapJsonUser);
  return _repo.listAll(empresaId);
}

async function createUser(fields) {
  if (!_repo) {
    const users = _loadJson();
    const id = Date.now();
    users.push({ id, usuario: fields.usuario, nome: fields.nome, senhaHash: fields.senhaHash, perfil: fields.perfil, ativo: true });
    _saveJson(users);
    return id;
  }
  return _repo.createUser(fields);
}

async function updateUser(id, fields, empresaId) {
  if (!_repo) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (!u) return false;
    if (fields.perfil !== undefined) u.perfil = fields.perfil;
    if (fields.ativo  !== undefined) u.ativo  = fields.ativo;
    _saveJson(users); return true;
  }
  return _repo.updateUser(id, fields, empresaId);
}

async function updatePassword(id, newHash) {
  if (!_repo) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (!u) return false;
    u.senhaHash = newHash; _saveJson(users); return true;
  }
  return _repo.updatePassword(id, newHash);
}

async function deleteUser(id, empresaId) {
  if (!_repo) {
    let users = _loadJson();
    users = users.filter(x => x.id !== id);
    _saveJson(users); return true;
  }
  return _repo.deleteUser(id, empresaId);
}

async function unlockUser(id) {
  if (!_repo) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (u) { u.lockUntil = null; u.failedAttempts = 0; _saveJson(users); }
    return true;
  }
  return _repo.unlockUser(id);
}

async function recordLoginFailure(id) {
  if (!_repo) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (!u) return;
    u.failedAttempts = (u.failedAttempts || 0) + 1;
    u.lastFailedAt = Date.now();
    if (u.failedAttempts >= cfg.auth.maxAttempts) { u.lockUntil = Date.now() + cfg.auth.lockoutMs; u.failedAttempts = 0; }
    _saveJson(users); return;
  }
  return _repo.recordLoginFailure(id, cfg.auth.maxAttempts, cfg.auth.lockoutMs);
}

async function clearLoginFailures(id) {
  if (!_repo) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (u) { u.failedAttempts = 0; u.lockUntil = null; _saveJson(users); }
    return;
  }
  return _repo.clearLoginFailures(id);
}

// ── Permissões ────────────────────────────────────────────────────────────

async function getUserPermissions(userId) {
  if (_repo) return _repo.getUserPermissions(userId);
  try {
    const file = path.join(__dirname, 'user_permissions.json');
    if (!fs.existsSync(file)) return null;
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    return map[String(userId)] || null;
  } catch(e) { return null; }
}

async function saveUserPermissions(userId, permsObj) {
  if (_repo) return _repo.saveUserPermissions(userId, permsObj);
  try {
    const file = path.join(__dirname, 'user_permissions.json');
    const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    map[String(userId)] = permsObj;
    fs.writeFileSync(file, JSON.stringify(map, null, 2)); return true;
  } catch(e) { return false; }
}

// ── Refresh Tokens ────────────────────────────────────────────────────────

function makeRefreshToken()  { return crypto.randomBytes(32).toString('hex'); }
function _hashRefresh(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

async function issueRefreshToken(res, userId, COOKIE_SECURE) {
  const token     = makeRefreshToken();
  const tokenHash = _hashRefresh(token);
  const expiresMs = cfg.auth.refreshTokenMs;
  const expiresAt = Date.now() + expiresMs;

  if (_repo) {
    await _repo.insertRefreshToken(tokenHash, userId, expiresAt);
  } else {
    const tokens = _loadRefreshJson();
    const now = Date.now();
    for (const [k, v] of Object.entries(tokens)) { if (v.expiresAt < now) delete tokens[k]; }
    tokens[tokenHash] = { userId, expiresAt, hashed: true };
    _saveRefreshJson(tokens);
  }

  const cookieOpts = { httpOnly: true, sameSite: 'lax', maxAge: expiresMs };
  if (COOKIE_SECURE) cookieOpts.secure = true;
  res.cookie('refresh_token', token, cookieOpts);
  return token;
}

async function findRefreshToken(token) {
  const tokenHash = _hashRefresh(token);
  if (!_repo) {
    const tokens = _loadRefreshJson();
    const info = tokens[tokenHash];
    if (!info || Date.now() > info.expiresAt) return null;
    return { userId: info.userId, expiresAt: info.expiresAt };
  }
  return _repo.findRefreshToken(tokenHash);
}

async function rotateRefreshToken(res, oldToken, userId, COOKIE_SECURE) {
  const oldHash = _hashRefresh(oldToken);
  if (_repo) {
    await _repo.deleteRefreshToken(oldHash);
  } else {
    const tokens = _loadRefreshJson();
    delete tokens[oldHash];
    _saveRefreshJson(tokens);
  }
  return issueRefreshToken(res, userId, COOKIE_SECURE);
}

async function deleteRefreshToken(res, token) {
  if (_repo && token) await _repo.deleteRefreshToken(_hashRefresh(token));
  else if (!_repo && token) {
    const tokens = _loadRefreshJson();
    delete tokens[_hashRefresh(token)];
    _saveRefreshJson(tokens);
  }
  try { res.clearCookie('refresh_token'); } catch(e) {}
}

// ── Audit ─────────────────────────────────────────────────────────────────

async function appendAudit(action, actorUserId = null, opts = {}) {
  const { entityType = null, entityId = null, targetUserId = null, detail = null, ip = null, userAgent = null } = opts;
  if (_repo) {
    try { await _repo.appendAudit(action, actorUserId, { entityType, entityId, targetUserId, detail, ip, userAgent }); }
    catch(e) { console.error('[users-db] audit error', e.message); }
    return;
  }
  try {
    let arr = fs.existsSync(AUDIT_FILE) ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')) : [];
    arr.push({ action, entityType, entityId, targetUserId, actorUserId, detail, ip, userAgent, when: new Date().toISOString() });
    if (arr.length > 1000) arr = arr.slice(-1000);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(arr, null, 2));
  } catch(e) { console.error('[users-db] audit json error', e.message); }
}

async function getAuditEntries(filters = {}) {
  if (_repo) return _repo.getAuditEntries(filters);
  try {
    let arr = fs.existsSync(AUDIT_FILE) ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')) : [];
    arr = arr.slice().reverse();
    return { entries: arr.slice(0, filters.limit || 100), total: arr.length, page: 1, limit: filters.limit || 100, pages: 1 };
  } catch(e) { return { entries: [], total: 0, page: 1, limit: 100, pages: 0 }; }
}

// ── Exports (idênticos à versão anterior) ─────────────────────────────────

module.exports = {
  init, ensureDefaultEmpresa, ensureAdmin,
  findByUsuario, findById, listAll,
  createUser, updateUser, updatePassword, deleteUser,
  unlockUser, recordLoginFailure, clearLoginFailures,
  getUserPermissions, saveUserPermissions,
  issueRefreshToken, findRefreshToken, rotateRefreshToken, deleteRefreshToken,
  appendAudit, getAuditEntries,
};
