-- ============================================================
-- migrate_v4.sql  —  Multi-tenancy: tabela empresa + empresa_id
--
-- Adiciona suporte multi-tenant (row-level):
--   1. Cria tabela `empresa` (cadastro de tenants)
--   2. Adiciona `empresa_id` em: plano, conta, lancamento,
--      fornecedor, recibo, usuario, audit_log
--   3. Cria empresa padrão (id=1) e vincula todos os dados
--      existentes a ela (zero downtime para instâncias single-tenant)
--   4. Garante unicidade de username por empresa
-- ============================================================
USE `plano_contas`;

-- ── 1. Tabela empresa ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `empresa` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`       VARCHAR(200)    NOT NULL,
  `slug`       VARCHAR(100)    NOT NULL,
  `plano`      VARCHAR(50)     NOT NULL DEFAULT 'basico',
  `ativo`      TINYINT(1)      NOT NULL DEFAULT 1,
  `dados`      TEXT            DEFAULT NULL,
  `created_at` DATETIME        DEFAULT NULL,
  `updated_at` DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_empresa_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- ── 2. Empresa padrão (id=1) para dados existentes ───────────
INSERT IGNORE INTO `empresa` (`id`, `nome`, `slug`, `plano`, `ativo`, `created_at`)
VALUES (1, 'Empresa Padrão', 'default', 'basico', 1, NOW());

-- ── 3. empresa_id em plano ────────────────────────────────────
SET @c = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='plano' AND COLUMN_NAME='empresa_id');
SET @s = IF(@c=0, 'ALTER TABLE `plano` ADD COLUMN `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE `plano` SET `empresa_id` = 1 WHERE `empresa_id` = 0 OR `empresa_id` IS NULL;

-- ── 4. empresa_id em conta ────────────────────────────────────
SET @c = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='conta' AND COLUMN_NAME='empresa_id');
SET @s = IF(@c=0, 'ALTER TABLE `conta` ADD COLUMN `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE `conta` SET `empresa_id` = 1 WHERE `empresa_id` = 0 OR `empresa_id` IS NULL;

-- ── 5. empresa_id em lancamento ───────────────────────────────
SET @c = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='lancamento' AND COLUMN_NAME='empresa_id');
SET @s = IF(@c=0, 'ALTER TABLE `lancamento` ADD COLUMN `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE `lancamento` SET `empresa_id` = 1 WHERE `empresa_id` = 0 OR `empresa_id` IS NULL;

-- ── 6. empresa_id em fornecedor ───────────────────────────────
SET @c = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fornecedor' AND COLUMN_NAME='empresa_id');
SET @s = IF(@c=0, 'ALTER TABLE `fornecedor` ADD COLUMN `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE `fornecedor` SET `empresa_id` = 1 WHERE `empresa_id` = 0 OR `empresa_id` IS NULL;

-- ── 7. empresa_id em recibo ───────────────────────────────────
SET @c = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recibo' AND COLUMN_NAME='empresa_id');
SET @s = IF(@c=0, 'ALTER TABLE `recibo` ADD COLUMN `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE `recibo` SET `empresa_id` = 1 WHERE `empresa_id` = 0 OR `empresa_id` IS NULL;

-- ── 8. empresa_id em usuario ──────────────────────────────────
SET @c = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuario' AND COLUMN_NAME='empresa_id');
SET @s = IF(@c=0, 'ALTER TABLE `usuario` ADD COLUMN `empresa_id` BIGINT UNSIGNED DEFAULT NULL AFTER `id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Vincula admin existente (superadmin não tem empresa_id)
-- Demais usuários vão para empresa padrão
UPDATE `usuario` SET `empresa_id` = 1 WHERE `empresa_id` IS NULL AND `perfil` != 'superadmin';

-- ── 9. empresa_id em audit_log ────────────────────────────────
SET @c = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_log' AND COLUMN_NAME='empresa_id');
SET @s = IF(@c=0, 'ALTER TABLE `audit_log` ADD COLUMN `empresa_id` BIGINT UNSIGNED DEFAULT NULL AFTER `id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 10. Índices por empresa ───────────────────────────────────
SET @i = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='conta' AND INDEX_NAME='idx_conta_empresa');
SET @s = IF(@i=0, 'CREATE INDEX `idx_conta_empresa` ON `conta` (`empresa_id`)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @i = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='lancamento' AND INDEX_NAME='idx_lanc_empresa');
SET @s = IF(@i=0, 'CREATE INDEX `idx_lanc_empresa` ON `lancamento` (`empresa_id`)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @i = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fornecedor' AND INDEX_NAME='idx_forn_empresa');
SET @s = IF(@i=0, 'CREATE INDEX `idx_forn_empresa` ON `fornecedor` (`empresa_id`)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @i = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuario' AND INDEX_NAME='idx_usuario_empresa');
SET @s = IF(@i=0, 'CREATE INDEX `idx_usuario_empresa` ON `usuario` (`empresa_id`)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 11. Unicidade usuário por empresa (substitui ux_usuario global) ──────────
-- Só cria o índice composto se o antigo ainda existir
SET @old = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuario' AND INDEX_NAME='ux_usuario');
SET @new = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuario' AND INDEX_NAME='ux_usuario_empresa');
SET @s = IF(@old > 0 AND @new = 0,
  'ALTER TABLE `usuario` DROP INDEX `ux_usuario`, ADD UNIQUE KEY `ux_usuario_empresa` (`usuario`, `empresa_id`)',
  IF(@new = 0,
    'ALTER TABLE `usuario` ADD UNIQUE KEY `ux_usuario_empresa` (`usuario`, `empresa_id`)',
    'SELECT 1'
  )
);
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 12. Registrar migração ────────────────────────────────────
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version`    VARCHAR(20)  NOT NULL,
  `applied_at` DATETIME     NOT NULL DEFAULT NOW(),
  `descricao`  VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

INSERT IGNORE INTO `schema_migrations` (`version`, `applied_at`, `descricao`)
VALUES ('v4', NOW(), 'Multi-tenancy: tabela empresa + empresa_id em todas as tabelas de dados');

-- Fim
