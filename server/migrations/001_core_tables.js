'use strict';

/**
 * Migração 001 — Tabelas core: conta, lancamento, usuario, empresa, refresh_token, audit_log.
 * Todas as DDL são idempotentes (CREATE TABLE IF NOT EXISTS).
 */
module.exports = {
  version: 1,
  name: 'core_tables',
  async up(db) {
    // Empresa (multi-tenant)
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`empresa\` (
        \`id\`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`nome\`       VARCHAR(200)    NOT NULL DEFAULT '',
        \`cnpj\`       VARCHAR(30)     DEFAULT NULL,
        \`ativo\`      TINYINT(1)      NOT NULL DEFAULT 1,
        \`created_at\` DATETIME        DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);

    // Usuario
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`usuario\` (
        \`id\`                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        \`empresa_id\`          BIGINT UNSIGNED DEFAULT NULL,
        \`usuario\`             VARCHAR(100)  NOT NULL,
        \`nome\`                VARCHAR(200)  DEFAULT NULL,
        \`senha_hash\`          VARCHAR(255)  NOT NULL,
        \`perfil\`              VARCHAR(50)   NOT NULL DEFAULT 'operador',
        \`ativo\`               TINYINT(1)    NOT NULL DEFAULT 1,
        \`failed_logins\`       INT           NOT NULL DEFAULT 0,
        \`lock_until\`          BIGINT        DEFAULT NULL,
        \`must_change_password\` TINYINT(1)  NOT NULL DEFAULT 0,
        \`created_at\`          DATETIME      DEFAULT NULL,
        \`updated_at\`          DATETIME      DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`ux_usuario_empresa\` (\`usuario\`, \`empresa_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);

    // Conta
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`conta\` (
        \`id\`         INT UNSIGNED    NOT NULL AUTO_INCREMENT,
        \`empresa_id\` BIGINT UNSIGNED NOT NULL DEFAULT 1,
        \`parent_id\`  INT UNSIGNED    DEFAULT NULL,
        \`codigo\`     VARCHAR(50)     NOT NULL DEFAULT '',
        \`nome\`       VARCHAR(200)    NOT NULL DEFAULT '',
        \`natureza\`   VARCHAR(20)     NOT NULL DEFAULT 'saida',
        \`orcamento\`  DECIMAL(19,2)   DEFAULT NULL,
        \`ordem\`      INT             DEFAULT NULL,
        \`deleted_at\` DATETIME        DEFAULT NULL,
        \`created_at\` DATETIME        DEFAULT NULL,
        \`updated_at\` DATETIME        DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);

    // Lancamento
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`lancamento\` (
        \`id\`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`empresa_id\`   BIGINT UNSIGNED NOT NULL DEFAULT 1,
        \`conta_id\`     INT UNSIGNED    NOT NULL,
        \`data\`         DATE            NOT NULL,
        \`tipo\`         VARCHAR(10)     NOT NULL DEFAULT 'debito',
        \`valor\`        DECIMAL(19,2)   NOT NULL DEFAULT 0,
        \`descricao\`    TEXT            DEFAULT NULL,
        \`fornecedor_id\` INT UNSIGNED   DEFAULT NULL,
        \`deleted_at\`   DATETIME        DEFAULT NULL,
        \`created_at\`   DATETIME        DEFAULT NULL,
        \`updated_at\`   DATETIME        DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);

    // Refresh token
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`refresh_token\` (
        \`id\`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\`    INT UNSIGNED    NOT NULL,
        \`token_hash\` VARCHAR(64)     NOT NULL,
        \`hashed\`     TINYINT(1)      NOT NULL DEFAULT 0,
        \`expires_at\` DATETIME        NOT NULL,
        \`created_at\` DATETIME        DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`ux_refresh_token_hash\` (\`token_hash\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);

    // Audit log
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`audit_log\` (
        \`id\`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`empresa_id\`    BIGINT UNSIGNED DEFAULT NULL,
        \`actor_user_id\` INT             DEFAULT NULL,
        \`action\`        VARCHAR(100)    NOT NULL DEFAULT '',
        \`entity_type\`   VARCHAR(50)     DEFAULT NULL,
        \`entity_id\`     VARCHAR(100)    DEFAULT NULL,
        \`details\`       TEXT            DEFAULT NULL,
        \`ip\`            VARCHAR(45)     DEFAULT NULL,
        \`when\`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci
    `);
  },
};
