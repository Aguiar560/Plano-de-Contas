'use strict';

/**
 * Migração 005 — Deduplicação de importação OFX/CSV.
 *
 * Adiciona `lancamento.fit_id` (identificador único da transação no extrato,
 * vindo do campo FITID do OFX ou de um hash de conteúdo no CSV) e um índice
 * único por (empresa_id, conta_id, fit_id) que impede o mesmo lançamento de
 * ser importado duas vezes ao reimportar um extrato ou importar períodos
 * sobrepostos.
 *
 * O índice único permite múltiplos NULL (lançamentos manuais, sem fit_id),
 * então lançamentos digitados à mão não são afetados.
 *
 * Idempotente: ADD COLUMN ignora errno 1060; ADD UNIQUE ignora errno 1061.
 */
module.exports = {
  version: 5,
  name: 'ofx_fitid_dedup',
  async up(db) {
    const addCol = async (tbl, col, def) => {
      try { await db.query(`ALTER TABLE \`${tbl}\` ADD COLUMN \`${col}\` ${def}`); }
      catch(e) { if (!e || e.errno !== 1060) throw e; }
    };
    const addUnique = async (tbl, name, cols) => {
      try { await db.query(`ALTER TABLE \`${tbl}\` ADD UNIQUE KEY \`${name}\` (${cols})`); }
      catch(e) { if (!e || e.errno !== 1061) throw e; }
    };

    await addCol('lancamento', 'fit_id', 'VARCHAR(255) DEFAULT NULL');
    await addUnique('lancamento', 'ux_lanc_empresa_conta_fit', '`empresa_id`, `conta_id`, `fit_id`');
  },
};
