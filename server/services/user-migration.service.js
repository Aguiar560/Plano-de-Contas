'use strict';

/**
 * UserMigrationService — criação de schema de usuários e migração one-time de JSON → DB.
 *
 * Separado de users-db.js para manter a responsabilidade de setup/migração isolada
 * da lógica de acesso a dados de runtime.
 */

const path = require('path');
const fs   = require('fs');

const USERS_FILE    = path.join(__dirname, '../users.json');
const MIGRATED_FILE = path.join(__dirname, '../.users_migrated');

// ── Garantir schema ───────────────────────────────────────────────────────

async function ensureTables(pool) {
  if (!pool) return;

  async function _colExists(table, col) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
      [table, col]
    );
    return Number(rows[0].c) > 0;
  }

  async function _tableExists(table) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
      [table]
    );
    return Number(rows[0].c) > 0;
  }

  // empresa
  if (!await _tableExists('empresa')) {
    await pool.execute(`
      CREATE TABLE empresa (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        nome       VARCHAR(200)    NOT NULL,
        slug       VARCHAR(100)    NOT NULL,
        plano      VARCHAR(50)     NOT NULL DEFAULT 'basico',
        ativo      TINYINT(1)      NOT NULL DEFAULT 1,
        dados      TEXT            DEFAULT NULL,
        created_at DATETIME        DEFAULT NULL,
        updated_at DATETIME        DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY ux_empresa_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    `);
  }

  // usuario
  if (!await _tableExists('usuario')) {
    await pool.execute(`
      CREATE TABLE usuario (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        empresa_id      BIGINT UNSIGNED DEFAULT NULL,
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
        UNIQUE KEY ux_usuario_empresa (usuario, empresa_id),
        KEY idx_usuario_empresa (empresa_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    `);
  } else {
    // adaptar coluna login → usuario se necessário
    if (!await _colExists('usuario', 'usuario') && await _colExists('usuario', 'login')) {
      await pool.execute('ALTER TABLE usuario CHANGE COLUMN login usuario VARCHAR(50) NOT NULL');
    }
    // colunas ausentes
    const cols = [
      ['empresa_id',      'ADD COLUMN empresa_id      BIGINT UNSIGNED DEFAULT NULL AFTER id'],
      ['perfil',          "ADD COLUMN perfil          VARCHAR(20)  NOT NULL DEFAULT 'visualizador'"],
      ['ativo',           'ADD COLUMN ativo           TINYINT(1)   NOT NULL DEFAULT 1'],
      ['failed_attempts', 'ADD COLUMN failed_attempts INT          NOT NULL DEFAULT 0'],
      ['lock_until',      'ADD COLUMN lock_until      BIGINT       DEFAULT NULL'],
      ['last_failed_at',  'ADD COLUMN last_failed_at  BIGINT       DEFAULT NULL'],
      ['nome',            "ADD COLUMN nome            VARCHAR(200) NOT NULL DEFAULT ''"],
      ['senha_hash',      "ADD COLUMN senha_hash      VARCHAR(255) NOT NULL DEFAULT ''"],
    ];
    for (const [col, ddl] of cols) {
      if (!await _colExists('usuario', col)) await pool.execute(`ALTER TABLE usuario ${ddl}`);
    }
    // índice único por empresa
    const hasOldUx = await pool.execute(
      "SELECT COUNT(1) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuario' AND INDEX_NAME='ux_usuario'"
    ).then(([r]) => Number(r[0].c) > 0).catch(() => false);
    const hasNewUx = await pool.execute(
      "SELECT COUNT(1) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuario' AND INDEX_NAME='ux_usuario_empresa'"
    ).then(([r]) => Number(r[0].c) > 0).catch(() => false);
    if (hasOldUx && !hasNewUx) {
      await pool.execute('ALTER TABLE usuario DROP INDEX ux_usuario, ADD UNIQUE KEY ux_usuario_empresa (usuario, empresa_id)').catch(() => {});
    } else if (!hasNewUx) {
      await pool.execute('ALTER TABLE usuario ADD UNIQUE KEY ux_usuario_empresa (usuario, empresa_id)').catch(() => {});
    }
  }

  // refresh_token
  if (!await _tableExists('refresh_token')) {
    await pool.execute(`
      CREATE TABLE refresh_token (
        token       VARCHAR(128)    NOT NULL,
        usuario_id  BIGINT UNSIGNED NOT NULL,
        expires_at  BIGINT          NOT NULL,
        hashed      TINYINT(1)      NOT NULL DEFAULT 1,
        created_at  DATETIME        DEFAULT NULL,
        PRIMARY KEY (token),
        KEY idx_rt_usuario (usuario_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    `);
  } else {
    if (!await _colExists('refresh_token', 'hashed')) {
      await pool.execute('ALTER TABLE refresh_token ADD COLUMN hashed TINYINT(1) NOT NULL DEFAULT 1');
    }
  }

  // user_permissions
  if (!await _tableExists('user_permissions')) {
    await pool.execute(`
      CREATE TABLE user_permissions (
        usuario_id  BIGINT UNSIGNED NOT NULL,
        perms_json  TEXT            NOT NULL,
        updated_at  DATETIME        NOT NULL,
        PRIMARY KEY (usuario_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    `);
  }

  // audit_log
  if (!await _tableExists('audit_log')) {
    await pool.execute(`
      CREATE TABLE audit_log (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    `);
  } else {
    const auditCols = [
      ['entity_type', 'ADD COLUMN entity_type    VARCHAR(50)  DEFAULT NULL'],
      ['entity_id',   'ADD COLUMN entity_id      VARCHAR(100) DEFAULT NULL'],
      ['detail',      'ADD COLUMN detail         TEXT         DEFAULT NULL'],
      ['ip_address',  'ADD COLUMN ip_address     VARCHAR(45)  DEFAULT NULL'],
      ['user_agent',  'ADD COLUMN user_agent     VARCHAR(500) DEFAULT NULL'],
    ];
    for (const [col, ddl] of auditCols) {
      if (!await _colExists('audit_log', col)) await pool.execute(`ALTER TABLE audit_log ${ddl}`);
    }
  }
}

// ── Migração one-time de users.json → banco ───────────────────────────────

async function migrateFromJson(pool) {
  if (!pool) return;
  if (fs.existsSync(MIGRATED_FILE)) return;
  if (!fs.existsSync(USERS_FILE)) { _markMigrated(); return; }

  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    for (const u of users) {
      try {
        await pool.execute(
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
            u.lastFailedAt || null,
          ]
        );
      } catch(e) {
        console.warn('[user-migration] Falha ao migrar usuário', u.usuario, e.message);
      }
    }
    console.log('[user-migration] Migração de users.json concluída —', users.length, 'usuários importados.');
    _markMigrated();
  } catch(e) {
    console.warn('[user-migration] Não foi possível migrar users.json:', e.message);
  }
}

function _markMigrated() {
  try { fs.writeFileSync(MIGRATED_FILE, new Date().toISOString()); } catch(e) {}
}

module.exports = { ensureTables, migrateFromJson };
