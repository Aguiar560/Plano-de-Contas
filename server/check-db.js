const mysql = require('mysql2/promise');

async function main() {
  require('dotenv').config();
  require('dotenv').config();
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT||3306,10),
    user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME
  });
  const [[{ v }]] = await c.execute('SELECT VERSION() AS v');
  console.log('MySQL version:', v);

  const [tables] = await c.execute("SHOW TABLES");
  console.log('Tables:', tables.map(t => Object.values(t)[0]));

  const [cols] = await c.execute('SHOW COLUMNS FROM usuario');
  console.log('usuario cols:', cols.map(x => x.Field));

  await c.end();
}
main().catch(console.error);
