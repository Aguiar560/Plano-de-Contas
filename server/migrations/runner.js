'use strict';

/**
 * Migration runner simples com tabela schema_migrations.
 *
 * Cada migração é um objeto { version: number, name: string, up: async (db) => void }.
 * Migrações são idempotentes (CREATE TABLE IF NOT EXISTS, ADD COLUMN com try/catch).
 * Em banco já existente, as migrações rodam como no-ops e são registradas como aplicadas.
 */

async function _ensureMigrationsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`version\`    INT UNSIGNED NOT NULL,
      \`name\`       VARCHAR(255) NOT NULL,
      \`applied_at\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
  `);
}

async function _appliedVersions(db) {
  const rows = await db.query('SELECT version FROM schema_migrations ORDER BY version ASC');
  return new Set(rows.map(r => r.version));
}

/**
 * Executa migrações pendentes em ordem de versão.
 * @param {object} db        — instância do helper db (db.query / db.execute / db.pool)
 * @param {object} logger    — logger com .info() e .error()
 * @param {Array}  migrations — lista de { version, name, up }
 */
async function runMigrations(db, logger, migrations) {
  if (!db) return;
  await _ensureMigrationsTable(db);
  const applied = await _appliedVersions(db);

  const pending = migrations.filter(m => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  if (pending.length === 0) {
    logger.info('[migrations] Nenhuma migração pendente.');
    return;
  }

  for (const migration of pending) {
    logger.info(`[migrations] Aplicando v${migration.version}: ${migration.name}`);
    try {
      await migration.up(db, logger);
      await db.execute(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
        [migration.version, migration.name]
      );
      logger.info(`[migrations] v${migration.version} aplicada.`);
    } catch(e) {
      logger.error(`[migrations] Falha na v${migration.version}: ${migration.name}`, { err: e && e.message });
      throw e;
    }
  }
}

module.exports = { runMigrations };
