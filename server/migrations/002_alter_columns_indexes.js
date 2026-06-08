'use strict';

/**
 * Migração 002 — ADD COLUMN e ADD INDEX incrementais.
 * Todas as operações são idempotentes:
 *   - ADD COLUMN ignora errno 1060 (coluna já existe)
 *   - ADD INDEX ignora errno 1061 (índice já existe)
 *   - MODIFY COLUMN ignora erros (já no tipo correto)
 */
module.exports = {
  version: 2,
  name: 'alter_columns_indexes',
  async up(db) {
    const addCol = async (tbl, col, def) => {
      try { await db.query(`ALTER TABLE \`${tbl}\` ADD COLUMN \`${col}\` ${def}`); }
      catch(e) { if (!e || e.errno !== 1060) throw e; }
    };
    const addIdx = async (tbl, name, cols) => {
      try { await db.query(`ALTER TABLE \`${tbl}\` ADD INDEX \`${name}\` (${cols})`); }
      catch(e) { if (!e || e.errno !== 1061) throw e; }
    };
    const modifyCol = async (tbl, col, def) => {
      try { await db.query(`ALTER TABLE \`${tbl}\` MODIFY COLUMN \`${col}\` ${def}`); }
      catch(e) { /* ignora se já foi modificado */ }
    };

    // Colunas adicionadas progressivamente
    await addCol('lancamento', 'fornecedor_id',      'INT UNSIGNED DEFAULT NULL');
    await addCol('conta',      'updated_at',         'DATETIME DEFAULT NULL');
    await addCol('lancamento', 'updated_at',         'DATETIME DEFAULT NULL');
    await addCol('refresh_token', 'hashed',          'TINYINT(1) NOT NULL DEFAULT 0');
    await addCol('conta',      'empresa_id',         'BIGINT UNSIGNED NOT NULL DEFAULT 1');
    await addCol('lancamento', 'empresa_id',         'BIGINT UNSIGNED NOT NULL DEFAULT 1');
    await addCol('fornecedor', 'empresa_id',         'BIGINT UNSIGNED NOT NULL DEFAULT 1');
    await addCol('recibo',     'empresa_id',         'BIGINT UNSIGNED NOT NULL DEFAULT 1');
    await addCol('audit_log',  'empresa_id',         'BIGINT UNSIGNED DEFAULT NULL');
    await addCol('usuario',    'must_change_password','TINYINT(1) NOT NULL DEFAULT 0');

    // Expandir colunas de CPF/CNPJ para valores criptografados
    await modifyCol('fornecedor', 'cpf',            'VARCHAR(300) DEFAULT NULL');
    await modifyCol('fornecedor', 'cnpj',           'VARCHAR(300) DEFAULT NULL');
    await modifyCol('recibo',     'fornecedor_cpf', 'VARCHAR(300) DEFAULT NULL');

    // Índices de performance
    await addIdx('lancamento', 'idx_lanc_conta_del',   '`conta_id`, `deleted_at`');
    await addIdx('lancamento', 'idx_lanc_data_del',    '`data`, `deleted_at`');
    await addIdx('lancamento', 'idx_lanc_fornecedor',  '`fornecedor_id`');
    await addIdx('conta',      'idx_conta_del_codigo', '`deleted_at`, `codigo`');
    await addIdx('conta',      'idx_conta_parent_del', '`parent_id`, `deleted_at`');
    await addIdx('fornecedor', 'idx_forn_cpf',         '`cpf`');
    await addIdx('fornecedor', 'idx_forn_cnpj',        '`cnpj`');
    await addIdx('recibo',     'idx_recibo_ano',       '`ano`');
    await addIdx('conta',      'idx_conta_empresa',    '`empresa_id`');
    await addIdx('lancamento', 'idx_lanc_empresa',     '`empresa_id`');
    await addIdx('fornecedor', 'idx_forn_empresa',     '`empresa_id`');
    await addIdx('usuario',    'idx_usuario_empresa',  '`empresa_id`');
  },
};
