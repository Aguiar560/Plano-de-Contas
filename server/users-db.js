/**
 * users-db.js — Camada de acesso a dados para usuários, refresh tokens e audit
 *
 * Substitui os arquivos users.json, refresh_tokens.json e audit.json por tabelas MySQL.
 * Requer que o script db/migrate_usuarios.sql já tenha sido executado.
 *
 * Fallback: se o banco não estiver disponível, mantém comportamento do arquivo JSON
 * para não quebrar ambientes sem banco configurado.
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcryptjs');

// ── Referência ao pool MySQL (injetada em init()) ─────────────────────────
let _pool = null;

async function init(pool) {
  _pool = pool;
  await _ensureTables();
  await _migrateFromJson();
}

// ── Garantir que as tabelas existam (idempotente) ─────────────────────────
async function _ensureTables() {
  if (!_pool) return;

  // Helper: verifica se coluna existe em tabela (compatível MySQL 5.1+)
  async function _colExists(table, col) {
    const [rows] = await _pool.execute(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [table, col]
    );
    return Number(rows[0].c) > 0;
  }

  // Helper: verifica se tabela existe
  async function _tableExists(table) {
    const [rows] = await _pool.execute(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
      [table]
    );
    return Number(rows[0].c) > 0;
  }

  // ── Tabela usuario ────────────────────────────────────────────────────────
  if (!await _tableExists('usuario')) {
    await _pool.execute(
      `CREATE TABLE usuario (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        usuario         VARCHAR(50)     NOT NULL,
        nome            VARCHAR(200)    NOT NULL DEFAULT '',
        senha_hash      VARCHAR(255)    NOT NULL,
        perfil          VARCHAR(20)     NOT NULL DEFAULT 'visualizador',
        ativo           TINYINT(1)      NOT NULL DEFAULT 1,
        failed_attempts INT             NOT NULL DEFAULT 0,
        lock_until      BIGINT          DEFAULT NULL,
        last_failed_at  BIGINT          DEFAULT NULL,
        created_at      DATETIME        DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY ux_usuario (usuario)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8`
    );
  } else {
    // Adaptar tabela existente: renomear 'login' → 'usuario' se necessário
    if (!await _colExists('usuario', 'usuario') && await _colExists('usuario', 'login')) {
      await _pool.execute(`ALTER TABLE usuario CHANGE COLUMN login usuario VARCHAR(50) NOT NULL`);
    }
    // Adicionar colunas ausentes
    const cols = [
      ['perfil',          `ADD COLUMN perfil          VARCHAR(20)  NOT NULL DEFAULT 'visualizador'`],
      ['ativo',           `ADD COLUMN ativo           TINYINT(1)   NOT NULL DEFAULT 1`],
      ['failed_attempts', `ADD COLUMN failed_attempts INT          NOT NULL DEFAULT 0`],
      ['lock_until',      `ADD COLUMN lock_until      BIGINT       DEFAULT NULL`],
      ['last_failed_at',  `ADD COLUMN last_failed_at  BIGINT       DEFAULT NULL`],
      ['nome',            `ADD COLUMN nome            VARCHAR(200) NOT NULL DEFAULT ''`],
      ['senha_hash',      `ADD COLUMN senha_hash      VARCHAR(255) NOT NULL DEFAULT ''`],
    ];
    for (const [col, ddl] of cols) {
      if (!await _colExists('usuario', col)) {
        await _pool.execute(`ALTER TABLE usuario ${ddl}`);
      }
    }
  }

  // ── Tabela refresh_token ──────────────────────────────────────────────────
  if (!await _tableExists('refresh_token')) {
    await _pool.execute(
      `CREATE TABLE refresh_token (
        token       VARCHAR(128)    NOT NULL,
        usuario_id  BIGINT UNSIGNED NOT NULL,
        expires_at  BIGINT          NOT NULL,
        created_at  DATETIME        DEFAULT NULL,
        PRIMARY KEY (token),
        KEY idx_rt_usuario (usuario_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8`
    );
  }

  // ── Tabela user_permissions ───────────────────────────────────────────────
  if (!await _tableExists('user_permissions')) {
    await _pool.execute(
      `CREATE TABLE user_permissions (
        usuario_id  BIGINT UNSIGNED NOT NULL,
        perms_json  TEXT            NOT NULL,
        updated_at  DATETIME        NOT NULL,
        PRIMARY KEY (usuario_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8`
    );
  }

  // ── Tabela audit_log ──────────────────────────────────────────────────────
  if (!await _tableExists('audit_log')) {
    await _pool.execute(
      `CREATE TABLE audit_log (
        id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        action         VARCHAR(100)    NOT NULL,
        entity_type    VARCHAR(50)     DEFAULT NULL,
        entity_id      VARCHAR(100)    DEFAULT NULL,
        target_user_id BIGINT          DEFAULT NULL,
        actor_user_id  BIGINT          DEFAULT NULL,
        detail         TEXT            DEFAULT NULL,
        ip_address     VARCHAR(45)     DEFAULT NULL,
        user_agent     VARCHAR(500)    DEFAULT NULL,
        \`when\`         DATETIME        NOT NULL,
        PRIMARY KEY (id),
        KEY idx_audit_action (action),
        KEY idx_audit_when   (\`when\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8`
    );
  } else {
    const auditCols = [
      ['entity_type',    `ADD COLUMN entity_type    VARCHAR(50)  DEFAULT NULL`],
      ['entity_id',      `ADD COLUMN entity_id      VARCHAR(100) DEFAULT NULL`],
      ['detail',         `ADD COLUMN detail         TEXT         DEFAULT NULL`],
      ['ip_address',     `ADD COLUMN ip_address     VARCHAR(45)  DEFAULT NULL`],
      ['user_agent',     `ADD COLUMN user_agent     VARCHAR(500) DEFAULT NULL`],
    ];
    for (const [col, ddl] of auditCols) {
      if (!await _colExists('audit_log', col)) {
        await _pool.execute(`ALTER TABLE audit_log ${ddl}`);
      }
    }
  }
}

// ── Migração automática de users.json → banco (executa uma única vez) ─────
const USERS_FILE   = path.join(__dirname, 'users.json');
const MIGRATED_FILE = path.join(__dirname, '.users_migrated');

async function _migrateFromJson() {
  if (!_pool) return;
  if (fs.existsSync(MIGRATED_FILE)) return;
  if (!fs.existsSync(USERS_FILE)) { _markMigrated(); return; }

  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    for (const u of users) {
      try {
        await _pool.execute(
          `INSERT IGNORE INTO usuario (id, usuario, nome, senha_hash, perfil, ativo, failed_attempts, lock_until, last_failed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            u.id,
            (u.usuario || '').toLowerCase().trim(),
            u.nome || '',
            u.senhaHash || '',
            u.perfil || 'visualizador',
            u.ativo !== false ? 1 : 0,
            u.failedAttempts || 0,
            u.lockUntil || null,
            u.lastFailedAt || null
          ]
        );
      } catch (e) {
        console.warn('[users-db] Falha ao migrar usuário', u.usuario, e.message);
      }
    }
    console.log('[users-db] Migração de users.json concluída —', users.length, 'usuários importados.');
    _markMigrated();
  } catch (e) {
    console.warn('[users-db] Não foi possível migrar users.json:', e.message);
  }
}

function _markMigrated() {
  try { fs.writeFileSync(MIGRATED_FILE, new Date().toISOString()); } catch(e) {}
}

// ── Garantir admin padrão ─────────────────────────────────────────────────
async function ensureAdmin() {
  if (!_pool) {
    // fallback: usar arquivo JSON
    return _ensureAdminJson();
  }
  const [rows] = await _pool.execute('SELECT id FROM usuario WHERE usuario = ? LIMIT 1', ['admin']);
  if (rows.length === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    await _pool.execute(
      `INSERT INTO usuario (usuario, nome, senha_hash, perfil, ativo, created_at) VALUES (?,?,?,?,1,NOW())`,
      ['admin', 'Administrador', hash, 'admin']
    );
    console.log('Default admin created (usuario=admin, senha=admin)');
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

// ── CRUD de usuários ──────────────────────────────────────────────────────

async function findByUsuario(usuario) {
  if (!_pool) return _loadJson().find(u => u.usuario.toLowerCase() === usuario.toLowerCase()) || null;
  const [rows] = await _pool.execute(
    'SELECT * FROM usuario WHERE usuario = ? LIMIT 1',
    [usuario.toLowerCase()]
  );
  return rows[0] ? _mapRow(rows[0]) : null;
}

async function findById(id) {
  if (!_pool) return _loadJson().find(u => u.id === id) || null;
  const [rows] = await _pool.execute('SELECT * FROM usuario WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? _mapRow(rows[0]) : null;
}

async function listAll() {
  if (!_pool) return _loadJson().map(u => _mapJsonUser(u));
  const [rows] = await _pool.execute('SELECT id, usuario, nome, perfil, ativo, lock_until FROM usuario ORDER BY id');
  return rows.map(r => ({
    id:        r.id,
    usuario:   r.usuario,
    nome:      r.nome,
    perfil:    r.perfil,
    ativo:     !!r.ativo,
    lockUntil: r.lock_until || null
  }));
}

async function createUser({ usuario, nome, senhaHash, perfil }) {
  if (!_pool) {
    const users = _loadJson();
    const id = Date.now();
    const novo = { id, usuario, nome, senhaHash, perfil, ativo: true };
    users.push(novo);
    _saveJson(users);
    return id;
  }
  const [r] = await _pool.execute(
    `INSERT INTO usuario (usuario, nome, senha_hash, perfil, ativo, created_at) VALUES (?,?,?,?,1,NOW())`,
    [usuario.toLowerCase().trim(), nome.trim(), senhaHash, perfil]
  );
  return r.insertId;
}

async function updateUser(id, fields) {
  if (!_pool) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (!u) return false;
    if (fields.perfil !== undefined) u.perfil = fields.perfil;
    if (fields.ativo  !== undefined) u.ativo  = fields.ativo;
    _saveJson(users);
    return true;
  }
  const set = [];
  const vals = [];
  if (fields.perfil !== undefined) { set.push('perfil = ?'); vals.push(fields.perfil); }
  if (fields.ativo  !== undefined) { set.push('ativo = ?');  vals.push(fields.ativo ? 1 : 0); }
  if (!set.length) return true;
  vals.push(id);
  await _pool.execute(`UPDATE usuario SET ${set.join(', ')} WHERE id = ?`, vals);
  return true;
}

async function updatePassword(id, newHash) {
  if (!_pool) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (!u) return false;
    u.senhaHash = newHash;
    _saveJson(users);
    return true;
  }
  await _pool.execute('UPDATE usuario SET senha_hash = ? WHERE id = ?', [newHash, id]);
  return true;
}

async function deleteUser(id) {
  if (!_pool) {
    let users = _loadJson();
    users = users.filter(x => x.id !== id);
    _saveJson(users);
    return true;
  }
  await _pool.execute('DELETE FROM usuario WHERE id = ?', [id]);
  return true;
}

async function unlockUser(id) {
  if (!_pool) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (u) { u.lockUntil = null; u.failedAttempts = 0; _saveJson(users); }
    return true;
  }
  await _pool.execute('UPDATE usuario SET lock_until = NULL, failed_attempts = 0 WHERE id = ?', [id]);
  return true;
}

async function recordLoginFailure(id) {
  if (!_pool) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (!u) return;
    u.failedAttempts = (u.failedAttempts || 0) + 1;
    u.lastFailedAt = Date.now();
    if (u.failedAttempts >= 5) { u.lockUntil = Date.now() + (10*60*1000); u.failedAttempts = 0; }
    _saveJson(users);
    return;
  }
  // Incrementar atomicamente; se chegar em 5, aplicar lock de 10 min e resetar
  await _pool.execute(
    `UPDATE usuario SET
       failed_attempts = failed_attempts + 1,
       last_failed_at  = ?,
       lock_until      = CASE WHEN failed_attempts + 1 >= 5 THEN ? ELSE lock_until END,
       failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END
     WHERE id = ?`,
    [Date.now(), Date.now() + (10*60*1000), id]
  );
}

async function clearLoginFailures(id) {
  if (!_pool) {
    const users = _loadJson();
    const u = users.find(x => x.id === id);
    if (u) { u.failedAttempts = 0; u.lockUntil = null; _saveJson(users); }
    return;
  }
  await _pool.execute('UPDATE usuario SET failed_attempts = 0, lock_until = NULL WHERE id = ?', [id]);
}

// ── Permissões por usuário ───────────────────────────────────────────────

async function getUserPermissions(userId) {
  if (_pool) {
    const [rows] = await _pool.execute('SELECT perms_json FROM user_permissions WHERE usuario_id = ? LIMIT 1', [userId]);
    if (!rows[0]) return null;
    try { return JSON.parse(rows[0].perms_json); } catch(e) { return null; }
  }
  // fallback: ler do arquivo de permissões JSON
  try {
    const file = path.join(__dirname, 'user_permissions.json');
    if (!fs.existsSync(file)) return null;
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    return map[String(userId)] || null;
  } catch(e) { return null; }
}

async function saveUserPermissions(userId, permsObj) {
  const json = JSON.stringify(permsObj);
  if (_pool) {
    await _pool.execute(
      `INSERT INTO user_permissions (usuario_id, perms_json, updated_at) VALUES (?,?,NOW())
       ON DUPLICATE KEY UPDATE perms_json = VALUES(perms_json), updated_at = NOW()`,
      [userId, json]
    );
    return true;
  }
  try {
    const file = path.join(__dirname, 'user_permissions.json');
    const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    map[String(userId)] = permsObj;
    fs.writeFileSync(file, JSON.stringify(map, null, 2));
    return true;
  } catch(e) { return false; }
}

// ── Refresh Tokens ────────────────────────────────────────────────────────

const REFRESH_FILE = path.join(__dirname, 'refresh_tokens.json');
const crypto = require('crypto');

function makeRefreshToken() { return crypto.randomBytes(32).toString('hex'); }
function _hashRefresh(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

async function issueRefreshToken(res, userId, COOKIE_SECURE) {
  const token = makeRefreshToken();
  const tokenHash = _hashRefresh(token);
  const expiresMs = 7 * 24 * 60 * 60 * 1000;
  const expiresAt = Date.now() + expiresMs;

  if (_pool) {
    await _pool.execute('DELETE FROM refresh_token WHERE usuario_id = ? AND expires_at < ?', [userId, Date.now()]);
    await _pool.execute(
      'INSERT INTO refresh_token (token, usuario_id, expires_at, hashed) VALUES (?,?,?,1)',
      [tokenHash, userId, expiresAt]
    );
  } else {
    const tokens = _loadRefreshJson();
    const now = Date.now();
    for (const [k, v] of Object.entries(tokens)) { if (v.expiresAt < now) delete tokens[k]; }
    tokens[tokenHash] = { userId, expiresAt, hashed: true };
    _saveRefreshJson(tokens);
  }

  const cookieOpts = { httpOnly: true, sameSite: 'lax', maxAge: expiresMs };
  if (COOKIE_SECURE) cookieOpts.secure = true;
  res.cookie('refresh_token', token, cookieOpts); // cookie tem o token RAW; banco tem o hash
  return token;
}

async function findRefreshToken(token) {
  const tokenHash = _hashRefresh(token);
  if (!_pool) {
    const tokens = _loadRefreshJson();
    const info = tokens[tokenHash];
    if (!info || Date.now() > info.expiresAt) return null;
    return { userId: info.userId, expiresAt: info.expiresAt };
  }
  const [rows] = await _pool.execute(
    'SELECT usuario_id, expires_at FROM refresh_token WHERE token = ? AND hashed = 1 AND expires_at > ? LIMIT 1',
    [tokenHash, Date.now()]
  );
  return rows[0] ? { userId: rows[0].usuario_id, expiresAt: rows[0].expires_at } : null;
}

async function rotateRefreshToken(res, oldToken, userId, COOKIE_SECURE) {
  const oldHash = _hashRefresh(oldToken);
  if (_pool) {
    await _pool.execute('DELETE FROM refresh_token WHERE token = ? AND hashed = 1', [oldHash]);
  } else {
    const tokens = _loadRefreshJson();
    delete tokens[oldHash];
    _saveRefreshJson(tokens);
  }
  return issueRefreshToken(res, userId, COOKIE_SECURE);
}

async function deleteRefreshToken(res, token) {
  if (_pool) {
    if (token) {
      const tokenHash = _hashRefresh(token);
      await _pool.execute('DELETE FROM refresh_token WHERE token = ? AND hashed = 1', [tokenHash]);
    }
  } else {
    if (token) {
      const tokens = _loadRefreshJson();
      delete tokens[_hashRefresh(token)];
      _saveRefreshJson(tokens);
    }
  }
  try { res.clearCookie('refresh_token'); } catch(e) {}
}

// ── Audit ─────────────────────────────────────────────────────────────────

const AUDIT_FILE = path.join(__dirname, 'audit.json');

/**
 * appendAudit(action, actorUserId, opts?)
 *
 * @param {string} action         — ex: 'login', 'conta_criada', 'lancamento_deletado'
 * @param {number|null} actorUserId — ID do usuário que executou a ação
 * @param {object} opts
 *   @param {string}  opts.entityType   — 'conta' | 'lancamento' | 'usuario'
 *   @param {string}  opts.entityId     — ID/código da entidade afetada
 *   @param {number}  opts.targetUserId — (apenas ações de usuário)
 *   @param {object}  opts.detail       — snapshot {before, after} ou dados relevantes
 *   @param {string}  opts.ip           — IP do cliente
 *   @param {string}  opts.userAgent    — User-Agent do cliente
 */
async function appendAudit(action, actorUserId = null, opts = {}) {
  const { entityType = null, entityId = null, targetUserId = null, detail = null, ip = null, userAgent = null } = opts;
  const detailJson = detail ? JSON.stringify(detail) : null;

  if (_pool) {
    try {
      await _pool.execute(
        `INSERT INTO audit_log (action, entity_type, entity_id, target_user_id, actor_user_id, detail, ip_address, user_agent, \`when\`)
         VALUES (?,?,?,?,?,?,?,?,NOW())`,
        [action, entityType, entityId ? String(entityId) : null, targetUserId || null, actorUserId || null, detailJson, ip, userAgent]
      );
    } catch(e) { console.error('[users-db] audit error', e.message); }
    return;
  }
  // fallback JSON
  try {
    let arr = fs.existsSync(AUDIT_FILE) ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')) : [];
    arr.push({ action, entityType, entityId, targetUserId, actorUserId, detail, ip, userAgent, when: new Date().toISOString() });
    if (arr.length > 1000) arr = arr.slice(-1000);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(arr, null, 2));
  } catch(e) { console.error('[users-db] audit json error', e.message); }
}

/**
 * getAuditEntries(filters?)
 * @param {object} filters — action, entityType, entityId, actorUserId, dtI, dtF, page, limit
 */
async function getAuditEntries(filters = {}) {
  const { action, entityType, entityId, actorUserId, dtI, dtF, page = 1, limit = 100 } = filters;
  if (_pool) {
    const where = [];
    const params = [];
    if (action)       { where.push('action = ?');        params.push(action); }
    if (entityType)   { where.push('entity_type = ?');   params.push(entityType); }
    if (entityId)     { where.push('entity_id = ?');     params.push(String(entityId)); }
    if (actorUserId)  { where.push('actor_user_id = ?'); params.push(actorUserId); }
    if (dtI)          { where.push('`when` >= ?');       params.push(dtI + ' 00:00:00'); }
    if (dtF)          { where.push('`when` <= ?');       params.push(dtF + ' 23:59:59'); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (page - 1) * limit;
    const [[{ total }]] = await _pool.execute(
      `SELECT COUNT(*) AS total FROM audit_log ${whereClause}`, params
    );
    const [rows] = await _pool.execute(
      `SELECT id, action, entity_type AS entityType, entity_id AS entityId,
              target_user_id AS targetUserId, actor_user_id AS actorUserId,
              detail, ip_address AS ip, user_agent AS userAgent, \`when\`
       FROM audit_log ${whereClause}
       ORDER BY \`when\` DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { entries: rows.map(r => {
      let det = null;
      if (r.detail) { try { det = JSON.parse(r.detail); } catch(e) { det = r.detail; } }
      return { ...r, detail: det };
    }), total: Number(total), page, limit, pages: Math.max(1, Math.ceil(Number(total) / limit)) };
  }
  try {
    let arr = fs.existsSync(AUDIT_FILE) ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')) : [];
    arr = arr.slice().reverse(); // mais recente primeiro
    return { entries: arr.slice(0, limit), total: arr.length, page: 1, limit, pages: 1 };
  } catch(e) { return { entries: [], total: 0, page: 1, limit, pages: 0 }; }
}

// ── Helpers internos (fallback JSON) ─────────────────────────────────────

function _loadJson() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch(e) { return []; }
}

function _saveJson(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function _loadRefreshJson() {
  try { return JSON.parse(fs.readFileSync(REFRESH_FILE, 'utf8')); } catch(e) { return {}; }
}

function _saveRefreshJson(obj) {
  try { fs.writeFileSync(REFRESH_FILE, JSON.stringify(obj, null, 2)); } catch(e) {}
}

/** Mapeia linha MySQL para o formato esperado pelo server.js */
function _mapRow(r) {
  return {
    id:             r.id,
    usuario:        r.usuario,
    nome:           r.nome,
    senhaHash:      r.senha_hash,
    perfil:         r.perfil,
    ativo:          !!r.ativo,
    failedAttempts: r.failed_attempts || 0,
    lockUntil:      r.lock_until || null,
    lastFailedAt:   r.last_failed_at || null
  };
}

function _mapJsonUser(u) {
  return {
    id:        u.id,
    usuario:   u.usuario,
    nome:      u.nome,
    perfil:    u.perfil,
    ativo:     u.ativo !== false,
    lockUntil: u.lockUntil || null
  };
}

module.exports = {
  init,
  ensureAdmin,
  findByUsuario,
  findById,
  listAll,
  createUser,
  updateUser,
  updatePassword,
  deleteUser,
  unlockUser,
  recordLoginFailure,
  clearLoginFailures,
  issueRefreshToken,
  findRefreshToken,
  rotateRefreshToken,
  deleteRefreshToken,
  appendAudit,
  getAuditEntries,
  getUserPermissions,
  saveUserPermissions
};
