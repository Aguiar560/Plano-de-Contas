require('dotenv').config();
const mysql = require('mysql2/promise');

function makePool(extra) {
  const p = mysql.createPool(Object.assign({
    host:             process.env.DB_HOST || '127.0.0.1',
    port:             process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user:             process.env.DB_USER || 'root',
    password:         process.env.DB_PASS || '',
    database:         process.env.DB_NAME || 'plano_contas',
    charset:          'UTF8_UNICODE_CI',
    waitForConnections: true,
    connectionLimit:  10,
    queueLimit:       0
  }, extra));
  // Garantir SET NAMES em cada nova conexao do pool
  p.pool.on('connection', function(conn) {
    conn.query("SET NAMES 'utf8' COLLATE 'utf8_unicode_ci'");
  });
  return p;
}

// Pool normal -- multipleStatements DESABILITADO (seguranca)
const POOL = makePool({ multipleStatements: false });

// Pool separado usado APENAS pelo run-schema.js para scripts DDL multi-statement
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
