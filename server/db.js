require('dotenv').config();
const mysql = require('mysql2/promise');

// Railway injeta MYSQL_URL (ou DATABASE_URL) automaticamente pelo plugin MySQL.
// Se presente, usa a URL diretamente; caso contrário, usa as variáveis individuais.
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
const POOL = makePool({ multipleStatements: false });

// Pool separado usado APENAS por scripts DDL multi-statement
const POOL_MULTI = makePool({ multipleStatements: true, connectionLimit: 2 });

module.exports = {
  pool: POOL,
  poolMulti: POOL_MULTI,
  query: async (sql, params) => {
    const [rows] = await POOL.query(sql, params);
    return rows;
  },
  execute: async (sql, params) => {
    const [res] = await POOL.execute(sql, params);
    return res;
  }
};
