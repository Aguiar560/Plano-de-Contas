'use strict';

/**
 * Migration runner simples com tabela schema_migrations.
 *
 * Cada migração é um objeto { version: number, name: string, up: async (db) => void }.
 * Migrações são idempotentes (CREATE TABLE IF NOT EXISTS, ADD COLUMN com try/catch).
 * Em banco já existente, as migrações rodam como no-ops e são registradas como aplicadas.
 */

// DDL portável: `applied_at` SEM `DEFAULT CURRENT_TIMESTAMP` porque MySQL antigo
// (5.1) rejeita default CURRENT_TIMESTAMP em coluna DATETIME (ER_INVALID_DEFAULT).
// O timestamp é gravado via NOW() no INSERT de registro.
const _CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE \`schema_migrations\` (
    \`version\`    INT UNSIGNED NOT NULL,
    \`name\`       VARCHAR(255) NOT NULL DEFAULT '',
    \`applied_at\` DATETIME     NULL DEFAULT NULL,
    PRIMARY KEY (\`version\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
`;

async function _ensureMigrationsTable(db) {
  await db.query(_CREATE_MIGRATIONS_TABLE.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
  // Obs.: se a tabela já existir com um formato legado/incompatível, o registro
  // das migrações falha — mas isso é tratado de forma tolerante no loop (ver
  // runMigrations): a migração ainda é APLICADA (idempotente) e apenas re-roda
  // como no-op nos próximos boots. Não recriamos a tabela para evitar risco.
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
    } catch(e) {
      logger.error(`[migrations] Falha na v${migration.version}: ${migration.name}`, { err: e && e.message });
      throw e;
    }
    // Registro tolerante: uma falha ao gravar em schema_migrations (ex.: tabela
    // de controle legada/incompatível) NÃO deve abortar o loop nem reverter a
    // migração já aplicada — as migrações são idempotentes e re-rodam como no-op.
    try {
      await db.execute(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, NOW())',
        [migration.version, migration.name]
      );
    } catch(e) {
      logger.warn(`[migrations] v${migration.version} aplicada, mas o registro falhou (será re-tentado no próximo boot)`, { err: e && e.message });
    }
    logger.info(`[migrations] v${migration.version} aplicada.`);
  }
}

module.exports = { runMigrations };
