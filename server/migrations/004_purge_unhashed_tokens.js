'use strict';

/**
 * Migração 004 — Purge de refresh tokens não-hasheados (legados).
 * É idempotente: após o purge, não há mais rows com hashed=0, então re-execuções são no-ops.
 */
module.exports = {
  version: 4,
  name: 'purge_unhashed_tokens',
  async up(db, logger) {
    try {
      const [[{ cnt }]] = await db.pool.query(
        'SELECT COUNT(*) AS cnt FROM refresh_token WHERE hashed = 0'
      );
      if (cnt > 0) {
        await db.pool.query('DELETE FROM refresh_token WHERE hashed = 0');
        logger.info(`[migrations] ${cnt} refresh token(s) legado(s) removido(s) — usuários precisarão logar novamente.`);
      }
    } catch(e) {
      // A coluna 'hashed' pode não existir em instâncias muito antigas — ignora
      if (e.errno !== 1054) throw e;
    }
  },
};
