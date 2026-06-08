require('dotenv').config();
const mysql          = require('mysql2/promise');
const CircuitBreaker = require('./circuit-breaker');

// Códigos de erro que justificam re-tentativa (problemas de rede/pool transientes).
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
  'ER_CON_COUNT_ERROR', 'PROTOCOL_CONNECTION_LOST',
]);

// Railway injeta MYSQL_URL (ou DATABASE_URL) automaticamente pelo plugin MySQL.
function _parseDbUrl(url) {
  try {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     u.port ? parseInt(u.port, 10) : 3306,
      user:     u.username,
      password: u.password,
      database: u.pathname.replace(/^\//, ''),
    };
  } catch { return null; }
}

function _dbConfig() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  const fromUrl = url ? _parseDbUrl(url) : null;
  return fromUrl || {
    host:     process.env.DB_HOST || '127.0.0.1',
    port:     process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'plano_contas',
  };
}

function makePool(extra) {
  const base = Object.assign(_dbConfig(), {
    charset:            'UTF8_UNICODE_CI',
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
  });
  const p = mysql.createPool(Object.assign(base, extra));
  p.pool.on('connection', function(conn) {
    conn.query("SET NAMES 'utf8' COLLATE 'utf8_unicode_ci'");
  });
  return p;
}

// Pool normal — multipleStatements DESABILITADO (segurança)
const POOL       = makePool({ multipleStatements: false });
// Pool separado APENAS para scripts DDL multi-statement (migrations)
const POOL_MULTI = makePool({ multipleStatements: true, connectionLimit: 2 });

// Circuit breaker compartilhado: 5 falhas transientes abrem o circuito por 30s.
const _breaker = new CircuitBreaker({ failureThreshold: 5, halfOpenMs: 30_000 });

/**
 * Retry com exponential backoff para erros transientes.
 * Tentativas: 1 (imediata), 2 (+100ms), 3 (+200ms).
 * Lança o último erro se todas as tentativas falharem.
 */
async function _withRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch(e) {
      lastError = e;
      if (!TRANSIENT_CODES.has(e.code) || attempt === maxAttempts) throw e;
      await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}

module.exports = {
  pool:      POOL,
  poolMulti: POOL_MULTI,
  breaker:   _breaker,

  /** Executa query SELECT/DML com retry e circuit breaker. */
  query: async (sql, params) => {
    return _breaker.call(() => _withRetry(async () => {
      const [rows] = await POOL.query(sql, params);
      return rows;
    }));
  },

  /** Executa prepared statement com retry e circuit breaker. */
  execute: async (sql, params) => {
    return _breaker.call(() => _withRetry(async () => {
      const [res] = await POOL.execute(sql, params);
      return res;
    }));
  },
};
