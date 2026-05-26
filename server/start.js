// start.js — inicia o servidor e captura todos os erros
// NOTA: não use require('./server.js') pois isso faz require.main !== module
// e o bloco app.listen() dentro de server.js nunca seria executado.
// Em vez disso, este arquivo apenas configura handlers globais de erro
// e então delega ao server.js via execução do mesmo processo.

process.on('uncaughtException', (e) => {
  console.error('[FATAL uncaughtException]', e.message, '\n', e.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL unhandledRejection]', reason && reason.message ? reason.message : reason);
  process.exit(1);
});

// Executa server.js como módulo principal
const { execFileSync } = require('child_process');
const path = require('path');
// Re-spawna node com server.js como main para que require.main === module funcione
const { spawn } = require('child_process');
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  stdio: 'inherit',
  env: process.env,
  cwd: __dirname
});
child.on('exit', (code) => process.exit(code || 0));
