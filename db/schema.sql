-- Schema MySQL para Plano de Contas (plano_contas)
-- Compatível com MySQL 8+

CREATE DATABASE IF NOT EXISTS `plano_contas` CHARACTER SET utf8 COLLATE utf8_unicode_ci;
USE `plano_contas`;

-- ── Tabela EMPRESA (multi-tenant) ────────────────────────────
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

-- Tabela PLANO: representa as raízes lógicas do plano (ENTRADAS e SAIDAS)
CREATE TABLE IF NOT EXISTS `plano` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `nome` VARCHAR(120) NOT NULL,
  `descricao` TEXT DEFAULT NULL,
  `slug` VARCHAR(120) DEFAULT NULL,
  `ordem` INT DEFAULT 0,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_plano_nome` (`nome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- Tabela CONTA: contas hierárquicas que pertencem a um PLANO
CREATE TABLE IF NOT EXISTS `conta` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `plano_id` BIGINT UNSIGNED NOT NULL,
  `parent_id` BIGINT UNSIGNED DEFAULT NULL,
  `codigo` VARCHAR(64) DEFAULT NULL,
  `nome` VARCHAR(200) NOT NULL,
  `natureza` ENUM('entrada','saida') NOT NULL DEFAULT 'saida',
  `orcamento` DECIMAL(19,2) NOT NULL DEFAULT 0.00,
  `ordem` INT DEFAULT 0,
  `meta` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conta_plano` (`plano_id`),
  KEY `idx_conta_parent` (`parent_id`),
  KEY `idx_conta_codigo` (`codigo`),
  CONSTRAINT `fk_conta_plano` FOREIGN KEY (`plano_id`) REFERENCES `plano`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_conta_parent` FOREIGN KEY (`parent_id`) REFERENCES `conta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- Tabela LANCAMENTO: lançamentos associados a uma conta (crédito/débito)
CREATE TABLE IF NOT EXISTS `lancamento` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `conta_id` BIGINT UNSIGNED NOT NULL,
  `data` DATE NOT NULL,
  `tipo` ENUM('credito','debito') NOT NULL,
  `valor` DECIMAL(19,2) NOT NULL,
  `descricao` TEXT DEFAULT NULL,
  `meta` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lanc_conta` (`conta_id`),
  KEY `idx_lanc_data` (`data`),
  KEY `idx_lanc_tipo` (`tipo`),
  CONSTRAINT `fk_lancamento_conta` FOREIGN KEY (`conta_id`) REFERENCES `conta`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- Tabela USUARIO (autenticação/RBAC) — empresa_id = NULL indica superadmin
CREATE TABLE IF NOT EXISTS `usuario` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id`      BIGINT UNSIGNED DEFAULT NULL,
  `usuario`         VARCHAR(50)     NOT NULL,
  `nome`            VARCHAR(200)    NOT NULL DEFAULT '',
  `senha_hash`      VARCHAR(255)    NOT NULL,
  `perfil`          VARCHAR(20)     NOT NULL DEFAULT 'visualizador',
  `ativo`           TINYINT(1)      NOT NULL DEFAULT 1,
  `failed_attempts` INT             NOT NULL DEFAULT 0,
  `lock_until`      BIGINT          DEFAULT NULL,
  `last_failed_at`  BIGINT          DEFAULT NULL,
  `created_at`      DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_usuario_empresa` (`usuario`, `empresa_id`),
  KEY `idx_usuario_empresa` (`empresa_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- Backups/versões do plano (simples)
CREATE TABLE IF NOT EXISTS `plano_backup` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plano_id` BIGINT UNSIGNED DEFAULT NULL,
  `payload` LONGTEXT NOT NULL,
  `descricao` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_backup_plano` (`plano_id`),
  CONSTRAINT `fk_backup_plano` FOREIGN KEY (`plano_id`) REFERENCES `plano`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- View: saldo agregado por conta (apenas lançamentos diretos)
CREATE OR REPLACE VIEW `vw_saldo_por_conta` AS
SELECT
  l.conta_id,
  SUM(CASE WHEN l.tipo = 'credito' THEN l.valor ELSE -l.valor END) AS saldo
FROM `lancamento` l
GROUP BY l.conta_id;

-- View: soma por conta incluindo subcontas não é trivial em SQL padrão sem CTE recursiva
-- (aplicação pode agregar subárvore). Disponibilizamos a view por conta direta acima.

-- Seeds: criar raiz PLANO com ENTRADAS e SAIDAS e alguns grupos padrão
INSERT INTO `plano` (`nome`, `descricao`, `ordem`, `created_at`) VALUES
  ('PLANO_DEFAULT', 'Raiz anônima que contém ENTRADAS e SAIDAS', 0, NOW())
ON DUPLICATE KEY UPDATE `nome` = `nome`;

-- Inserir ENTRADAS e SAIDAS se não existirem
INSERT INTO `plano` (`nome`,`descricao`,`ordem`,`created_at`)
SELECT * FROM (
  SELECT 'ENTRADAS' AS nome, 'Raiz de entradas (receitas)' AS descricao, 1 AS ordem, NOW() AS created_at
  UNION ALL
  SELECT 'SAIDAS', 'Raiz de saídas (despesas)', 2, NOW()
) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `plano` p WHERE p.nome = tmp.nome);

-- Se desejar popular contas padrão (ex.: SERVIÇOS, DESPESAS FINANCEIRAS, IMPOSTOS sob SAIDAS)
-- localizar id de SAIDAS
-- localizar id de SAIDAS (fallback por nome exato)
SET @saidas_id = (SELECT id FROM plano WHERE nome = 'SAIDAS' LIMIT 1);

-- Popular slug para registros existentes (se vazio)
-- Alguns clientes (ex.: MySQL Workbench) ativam 'safe update mode' e recusam
-- updates sem WHERE que use uma key. Para compatibilidade, desabilitamos a
-- checagem temporariamente na sessão e restauramos depois.
SET @OLD_SQL_SAFE_UPDATES = @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;
UPDATE plano SET slug = LOWER(REPLACE(nome,' ','_')) WHERE slug IS NULL OR slug = '';
SET SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;

-- Apenas inserir grupos se a raiz existir
INSERT INTO `conta` (`plano_id`,`parent_id`,`codigo`,`nome`,`natureza`,`orcamento`,`ordem`,`created_at`)
SELECT p.id, NULL, NULL, t.nome, 'saida', 0.00, t.ordem, NOW()
FROM (
  SELECT 'SERVIÇOS' AS nome, 1 AS ordem
  UNION ALL SELECT 'DESPESAS FINANCEIRAS', 2
  UNION ALL SELECT 'IMPOSTOS', 3
) t
JOIN plano p ON p.nome = 'SAIDAS'
LEFT JOIN conta c ON c.nome = t.nome AND c.plano_id = p.id
WHERE c.id IS NULL;

-- Índices adicionais recomendados
-- Índices adicionais recomendados
-- Criação direta de índices; se o seu servidor recusar caso o índice já exista,
-- remova ou execute manualmente conforme necessário.
-- Criar índice `ix_conta_nome` apenas se não existir
SET @cnt = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conta' AND INDEX_NAME = 'ix_conta_nome');
SET @sql = IF(@cnt = 0, 'CREATE INDEX `ix_conta_nome` ON `conta` (`nome`(100))', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Criar índice `ix_lanc_conta_data` apenas se não existir
SET @cnt = (SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lancamento' AND INDEX_NAME = 'ix_lanc_conta_data');
SET @sql = IF(@cnt = 0, 'CREATE INDEX `ix_lanc_conta_data` ON `lancamento` (`conta_id`, `data`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Triggers removidos: seu usuário não tem privilégios TRIGGER no servidor remoto.
-- Se desejar criar triggers automáticos, execute-os manualmente como um usuário com
-- privilégio TRIGGER/SUPER ou peça ao administrador do banco para conceder:
--   GRANT TRIGGER ON `plano_contas`.* TO 'seu_usuario'@'seu_host';
-- Em alternativa, considere executar os INSERTs com `created_at = NOW()` do lado do app.

-- Exemplo de consulta útil: saldo agregado de uma conta (direto) e porcentagem de orçamento
-- SELECT c.id, c.nome, COALESCE(v.saldo,0) AS saldo, c.orcamento,
--        CASE WHEN c.orcamento>0 THEN (COALESCE(v.saldo,0)/c.orcamento)*100 ELSE NULL END AS pct_orcamento
-- FROM conta c LEFT JOIN vw_saldo_por_conta v ON v.conta_id = c.id WHERE c.id = 123;

-- Fim do script
