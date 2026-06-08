'use strict';

/**
 * config.js — Parâmetros operacionais externalizados via variáveis de ambiente.
 *
 * Todos os valores têm defaults seguros para desenvolvimento.
 * Em produção, configure as variáveis de ambiente listadas abaixo.
 *
 * Variáveis disponíveis:
 *   LGPD_RETENTION_DAYS   — dias para manter lançamentos/contas deletados (padrão: 90)
 *   LGPD_AUDIT_LOG_DAYS   — dias para manter registros de audit_log (padrão: 365)
 *   AUTH_MAX_ATTEMPTS     — tentativas de login antes do lockout (padrão: 5)
 *   AUTH_LOCKOUT_MINUTES  — duração do lockout em minutos (padrão: 10)
 *   REFRESH_TOKEN_DAYS    — validade do refresh token em dias (padrão: 7)
 *   RATE_AUTH_MAX         — req/min na rota de login (padrão: 10)
 *   RATE_REFRESH_MAX      — req/min na rota de refresh (padrão: 30)
 *   RATE_WRITE_MAX        — req/min nas rotas de escrita (padrão: 60)
 *   RATE_READ_MAX         — req/min nas rotas de leitura (padrão: 200)
 *   MAX_LANCAMENTOS_YEAR  — limite de lançamentos por empresa/ano no GET bulk (padrão: 5000)
 *   MAX_CONTAS_EMPRESA    — limite de contas ativas por empresa no GET árvore (padrão: 2000)
 */

function _int(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

module.exports = {
  lgpd: {
    retentionDays: _int('LGPD_RETENTION_DAYS', 90),
    auditLogDays:  _int('LGPD_AUDIT_LOG_DAYS', 365),
  },

  auth: {
    maxAttempts:    _int('AUTH_MAX_ATTEMPTS',    5),
    lockoutMs:      _int('AUTH_LOCKOUT_MINUTES', 10) * 60 * 1000,
    refreshTokenMs: _int('REFRESH_TOKEN_DAYS',   7)  * 24 * 60 * 60 * 1000,
  },

  rateLimit: {
    auth:    { windowMs: 60_000, max: _int('RATE_AUTH_MAX',    10)  },
    refresh: { windowMs: 60_000, max: _int('RATE_REFRESH_MAX', 30)  },
    write:   { windowMs: 60_000, max: _int('RATE_WRITE_MAX',   60)  },
    read:    { windowMs: 60_000, max: _int('RATE_READ_MAX',    200) },
  },

  limits: {
    lancamentosPerYear: _int('MAX_LANCAMENTOS_YEAR', 5000),
    contasPerEmpresa:   _int('MAX_CONTAS_EMPRESA',   2000),
  },
};
