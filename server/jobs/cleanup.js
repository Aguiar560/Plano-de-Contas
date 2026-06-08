'use strict';

/**
 * cleanup.js — Jobs de manutenção periódica.
 *
 * Exporta createCleanupJobs({ db, revokedTokens, cryptoUtils, cfg, logger })
 * que retorna { start() } para iniciar os setIntervals.
 *
 * Cada intervalo:
 *   - usa .unref() para não bloquear o shutdown do processo
 *   - tem try/catch próprio para log de erros sem travar o job
 *   - é iniciado via _safeInterval() que garante as propriedades acima
 */

module.exports = function createCleanupJobs({ db, revokedTokens, cryptoUtils, cfg, logger }) {

  // ── Limpeza do blacklist de JTIs (a cada 5 min) ─────────────────────────

  async function _cleanJtiBlacklist() {
    const now = Date.now();
    for (const [jti, exp] of revokedTokens) if (exp < now) revokedTokens.delete(jti);
    if (db) await db.execute('DELETE FROM revoked_token WHERE expires_at <= NOW()');
  }

  // ── Purge de retenção LGPD (diário) ──────────────────────────────────────

  async function _runRetentionCleanup() {
    if (!db) return;
    const [r1] = await db.pool.query(
      `DELETE FROM lancamento WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL ${cfg.lgpd.retentionDays} DAY)`
    );
    const [r2] = await db.pool.query(
      `DELETE FROM conta      WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL ${cfg.lgpd.retentionDays} DAY)`
    );
    const [r3] = await db.pool.query(
      `DELETE FROM audit_log  WHERE \`when\` < DATE_SUB(NOW(), INTERVAL ${cfg.lgpd.auditLogDays} DAY)`
    );
    const [r4] = await db.pool.query(
      'DELETE FROM refresh_token WHERE expires_at < NOW()'
    );
    const total = (r1.affectedRows||0) + (r2.affectedRows||0) + (r3.affectedRows||0) + (r4.affectedRows||0);
    if (total > 0) logger.info('[retention] Purge concluído', {
      lancamentos: r1.affectedRows, contas: r2.affectedRows,
      auditLog: r3.affectedRows, tokens: r4.affectedRows,
    });
  }

  // ── Migração one-time de CPF/CNPJ para formato criptografado ─────────────

  async function _migrateEncryptCpf() {
    if (!db || !cryptoUtils) return;
    const { encrypt, isEncrypted } = cryptoUtils;
    const forns = await db.query('SELECT id, cpf, cnpj, dados FROM fornecedor WHERE cpf IS NOT NULL OR cnpj IS NOT NULL');
    for (const f of forns) {
      const updates = {};
      if (f.cpf  && !isEncrypted(f.cpf))  updates.cpf  = encrypt(f.cpf);
      if (f.cnpj && !isEncrypted(f.cnpj)) updates.cnpj = encrypt(f.cnpj);
      try {
        const dadosObj = JSON.parse(f.dados || '{}');
        if (dadosObj.cpf || dadosObj.cnpj) {
          delete dadosObj.cpf; delete dadosObj.cnpj;
          updates.dados = JSON.stringify(dadosObj);
        }
      } catch { /* dados corrompido — ignora */ }
      if (Object.keys(updates).length > 0)
        await db.pool.query('UPDATE fornecedor SET ? WHERE id = ?', [updates, f.id]);
    }
    const recibos = await db.query('SELECT id, fornecedor_cpf FROM recibo WHERE fornecedor_cpf IS NOT NULL');
    for (const r of recibos) {
      if (r.fornecedor_cpf && !isEncrypted(r.fornecedor_cpf)) {
        await db.pool.query('UPDATE recibo SET fornecedor_cpf = ? WHERE id = ?', [encrypt(r.fornecedor_cpf), r.id]);
      }
    }
    logger.info('[crypto] Migração de CPF/CNPJ concluída');
  }

  // ── Utilitário: intervalo seguro ──────────────────────────────────────────

  function _safeInterval(fn, ms) {
    return setInterval(async () => {
      try { await fn(); }
      catch(e) { logger.warn('[cleanup] Erro no job', { job: fn.name, err: e && e.message }); }
    }, ms).unref();
  }

  function _runOnce(fn, label) {
    setImmediate(async () => {
      try { await fn(); }
      catch(e) { logger.warn(`[cleanup] ${label} falhou na inicialização`, { err: e && e.message }); }
    });
  }

  // ── Ponto de entrada ──────────────────────────────────────────────────────

  function start() {
    // JTI blacklist: a cada 5 minutos
    _safeInterval(_cleanJtiBlacklist, 5 * 60 * 1000);

    // LGPD retention: ao iniciar + a cada 24 horas
    _runOnce(_runRetentionCleanup, 'retention cleanup');
    _safeInterval(_runRetentionCleanup, 24 * 60 * 60 * 1000);

    // Migração de CPF/CNPJ: one-time ao iniciar
    _runOnce(_migrateEncryptCpf, 'CPF/CNPJ encrypt migration');
  }

  return { start };
};
