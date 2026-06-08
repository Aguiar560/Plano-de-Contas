'use strict';

/**
 * server.js — Ponto de entrada HTTP.
 *
 * Responsabilidade única: inicializar dependências e abrir o socket TCP.
 * Toda a configuração do Express vive em app.js.
 * Os jobs de manutenção (cleanup, retention) vivem em jobs/cleanup.js.
 *
 * Re-exporta o app e os símbolos que os testes usam via require('../server').
 */

const app = require('./app');

// ── Re-exports para testes que fazem require('../server') ─────────────────
module.exports                 = app;
module.exports.migrationsReady = app.migrationsReady;
module.exports.revokedTokens   = app.revokedTokens;
module.exports.loadRevokedJtis = app.loadRevokedJtis;

// ── Startup: só executa quando invocado diretamente ───────────────────────
if (require.main === module) {
  const usersDb     = app._usersDb;
  const db          = app._db;
  const cryptoUtils = app._cryptoUtils;
  const cfg         = app._cfg;
  const logger      = app._logger;
  const PORT        = app._PORT;

  const createCleanupJobs = require('./jobs/cleanup');

  (async () => {
    // Inicializa usuários (schema + migração JSON + admin padrão)
    try {
      const pool = db && db.pool ? db.pool : null;
      await usersDb.init(pool);
      const defaultEmpresaId = await usersDb.ensureDefaultEmpresa();
      await usersDb.ensureAdmin(defaultEmpresaId);
    } catch(e) { console.error('usersDb init error:', e.message); }

    const server = app.listen(PORT, () =>
      logger.info('Servidor iniciado', { url: 'http://localhost:' + PORT })
    );
    server.on('error', e => logger.error('Erro no servidor HTTP', { err: e.message }));

    process.on('uncaughtException',    e => logger.error('Exceção não tratada',            { err: e.message, stack: e.stack }));
    process.on('unhandledRejection',   e => logger.error('Promise rejeitada sem tratamento', { err: e && e.message }));

    // Após migrações: carrega JTIs revogados e inicia jobs de cleanup
    app.migrationsReady.then(() => {
      app.loadRevokedJtis();
      createCleanupJobs({
        db, revokedTokens: app.revokedTokens, cryptoUtils, cfg, logger,
      }).start();
    });
  })();
}
