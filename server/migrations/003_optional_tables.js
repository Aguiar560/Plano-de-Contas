'use strict';

/**
 * Migração 003 — Tabelas opcionais: fornecedor, recibo, revoked_token.
 * Idempotente: CREATE TABLE IF NOT EXISTS + ADD COLUMN ignore 1060.
 */
module.exports = {
  version: 3,
  name: 'optional_tables',
  async up(db) {
    // Fornecedor
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`fornecedor\` (
        \`id\`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        \`empresa_id\`   BIGINT UNSIGNED NOT NULL DEFAULT 1,
        \`tipo_pessoa\`  VARCHAR(20)   NOT NULL DEFAULT 'juridica',
        \`razao_social\` VARCHAR(200)  NOT NULL DEFAULT '',
        \`nome_fantasia\`VARCHAR(200)  DEFAULT NULL,
        \`cnpj\`         VARCHAR(300)  DEFAULT NULL,
        \`cpf\`          VARCHAR(300)  DEFAULT NULL,
        \`status\`       VARCHAR(20)   NOT NULL DEFAULT 'ativo',
        \`dados\`        TEXT          NOT NULL,
        \`created_at\`   DATETIME      DEFAULT NULL,
        \`updated_at\`   DATETIME      DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);

    // Recibo
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`recibo\` (
        \`id\`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`empresa_id\`      BIGINT UNSIGNED NOT NULL DEFAULT 1,
        \`numero\`          INT            NOT NULL,
        \`ano\`             INT            NOT NULL,
        \`lancamento_id\`   BIGINT UNSIGNED DEFAULT NULL,
        \`conta_codigo\`    VARCHAR(64)    DEFAULT NULL,
        \`fornecedor_nome\` VARCHAR(200)   NOT NULL DEFAULT '',
        \`fornecedor_cpf\`  VARCHAR(300)   DEFAULT NULL,
        \`data\`            DATE           NOT NULL,
        \`valor\`           DECIMAL(19,2)  NOT NULL DEFAULT 0,
        \`descricao\`       TEXT           DEFAULT NULL,
        \`emitido_por\`     INT            DEFAULT NULL,
        \`created_at\`      DATETIME       DEFAULT NULL,
        \`assinado_em\`     DATETIME       DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`ux_recibo_num_ano_emp\` (\`numero\`, \`ano\`, \`empresa_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);
    // Adiciona unique key alternativa se a antiga (sem empresa_id) ainda existir
    try { await db.query('ALTER TABLE `recibo` ADD COLUMN `assinado_em` DATETIME DEFAULT NULL'); }
    catch(e) { if (e.errno !== 1060) throw e; }

    // JTI blacklist
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`revoked_token\` (
        \`jti\`        VARCHAR(64)  NOT NULL,
        \`expires_at\` DATETIME     NOT NULL,
        PRIMARY KEY (\`jti\`),
        INDEX \`idx_revtok_exp\` (\`expires_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);
  },
};
