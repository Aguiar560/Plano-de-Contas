'use strict';
/**
 * migrate.js — Executor de migrações versionadas
 *
 * Uso:
 *   node server/migrate.js              → aplica todas as migrações pendentes
 *   node server/migrate.js --status     → lista o estado atual
 *
 * Convenção de arquivos: db/migrate_vN.sql  (ex: migrate_v2.sql, migrate_v3.sql)
 * A ordem de aplicação é lexicográfica (v2 antes de v3).
 *
 * A tabela `schema_migrations` no banco registra as versões já aplicadas.
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const mysql = require('mysql2/promise');

const DB_DIR = path.join(__dirname, '..', 'db');

async function createPool() {
  return mysql.createPool({
    host:     process.env.DB_HOST || '127.0.0.1',
    port:     process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'plano_contas',
    multipleStatements: true,   // necessário para executar scripts SQL com múltiplos statements
    waitForConnections: true,
    connectionLimit: 2
  });
}

/** Garante que a tabela de controle de migrações exista */
async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`version\`    VARCHAR(20)  NOT NULL,
      \`applied_at\` DATETIME     NOT NULL DEFAULT NOW(),
      \`descricao\`  VARCHAR(255) DEFAULT NULL,
      PRIMARY KEY (\`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
  `);
}

/** Retorna o conjunto de versões já aplicadas */
async function appliedVersions(conn) {
  const [rows] = await conn.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(rows.map(r => r.version));
}

/** Extrai o identificador de versão do nome do arquivo  ex: "migrate_v3.sql" → "v3" */
function extractVersion(filename) {
  const m = filename.match(/migrate_(v\d+(?:\.\d+)*)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Lista arquivos de migração disponíveis, ordenados */
function migrationFiles() {
  return fs.readdirSync(DB_DIR)
    .filter(f => /^migrate_v\d/i.test(f) && f.endsWith('.sql'))
    .sort();
}

async function runMigrations(options = {}) {
  const pool = await createPool();
  const conn = await pool.getConnection();

  try {
    await ensureMigrationsTable(conn);
    const applied = await appliedVersions(conn);
    const files   = migrationFiles();

    if (options.status) {
      console.log('\n── Estado das migrações ────────────────────────────────');
      for (const f of files) {
        const v = extractVersion(f);
        const status = applied.has(v) ? '✓ aplicada' : '○ pendente';
        console.log(`  ${status}  ${f}`);
      }
      console.log('');
      return;
    }

    const pending = files.filter(f => {
      const v = extractVersion(f);
      return v && !applied.has(v);
    });

    if (pending.length === 0) {
      console.log('Nenhuma migração pendente.');
      return;
    }

    for (const file of pending) {
      const version = extractVersion(file);
      const filePath = path.join(DB_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`Aplicando migração: ${file} (${version})...`);
      try {
        await conn.query(sql);
        // Registrar como aplicada (pode já ter sido feita pelo script interno)
        await conn.query(
          'INSERT IGNORE INTO schema_migrations (version, applied_at, descricao) VALUES (?, NOW(), ?)',
          [version, `Aplicada por migrate.js em ${new Date().toISOString()}`]
        );
        console.log(`  ✓ ${version} aplicada com sucesso.`);
      } catch (err) {
        console.error(`  ✗ Erro ao aplicar ${version}:`, err.message);
        throw err;  // abortar para não aplicar próximas com banco inconsistente
      }
    }

    console.log(`\n${pending.length} migração(ões) aplicada(s) com sucesso.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

// Executar quando chamado diretamente
if (require.main === module) {
  const status = process.argv.includes('--status');
  runMigrations({ status })
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { runMigrations };
