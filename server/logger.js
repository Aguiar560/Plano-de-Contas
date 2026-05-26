'use strict';
/**
 * logger.js — Logger estruturado simples (sem dependências externas)
 *
 * Em produção (NODE_ENV=production) suprime debug/info e registra
 * apenas warn e error em formato JSON para facilitar coleta de logs.
 * Em desenvolvimento exibe saída legível colorida no console.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

function _timestamp() {
  return new Date().toISOString();
}

function _format(level, msg, meta) {
  if (IS_PROD) {
    // JSON de uma linha — compatível com fluentd, CloudWatch, etc.
    return JSON.stringify({ ts: _timestamp(), level, msg, ...meta });
  }
  const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `[${_timestamp()}] ${level.toUpperCase().padEnd(5)} ${msg}${metaStr}`;
}

const logger = {
  /** Detalhes internos — silenciado em produção */
  debug(msg, meta = {}) {
    if (!IS_PROD) console.log(_format('debug', msg, meta));
  },

  /** Informações de operação (requests, ações) — silenciado em produção */
  info(msg, meta = {}) {
    if (!IS_PROD) console.log(_format('info', msg, meta));
  },

  /** Avisos — sempre visíveis */
  warn(msg, meta = {}) {
    console.warn(_format('warn', msg, meta));
  },

  /** Erros — sempre visíveis */
  error(msg, meta = {}) {
    console.error(_format('error', msg, meta));
  },

  /** Middleware Express: registra método, URL e status de cada request */
  requestMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const ms = Date.now() - start;
        const level = res.statusCode >= 500 ? 'error'
                    : res.statusCode >= 400 ? 'warn'
                    : 'info';
        logger[level](`${req.method} ${req.url}`, { status: res.statusCode, ms });
      });
      next();
    };
  }
};

module.exports = logger;
