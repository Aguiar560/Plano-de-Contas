'use strict';

/**
 * CircuitBreaker — protege o pool MySQL contra latência/indisponibilidade.
 *
 * Estados:
 *   CLOSED   — operação normal; falhas contam para o threshold.
 *   OPEN     — falhas >= threshold; lança erro imediato por halfOpenMs.
 *   HALF_OPEN — tempo expirou; próxima chamada é uma sondagem de recuperação.
 *
 * Apenas erros transientes (ECONNREFUSED, ETIMEDOUT, etc.) contam.
 * Erros de SQL (ER_NO_SUCH_TABLE, etc.) não abrem o circuito.
 */

const TRANSIENT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
  'ER_CON_COUNT_ERROR', 'PROTOCOL_CONNECTION_LOST', 'ECIRCUIT',
]);

class CircuitBreaker {
  constructor({ failureThreshold = 5, halfOpenMs = 30_000, logger } = {}) {
    this.threshold   = failureThreshold;
    this.halfOpenMs  = halfOpenMs;
    this.logger      = logger || { warn: console.warn, info: console.info };
    this.failures    = 0;
    this.state       = 'CLOSED';
    this.nextAttempt = 0;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const err = new Error('DB circuit breaker OPEN — banco temporariamente indisponível');
        err.code   = 'ECIRCUIT';
        err.status = 503;
        throw err;
      }
      this.state = 'HALF_OPEN';
      this.logger.info('[circuit] Estado → HALF_OPEN — testando banco');
    }

    try {
      const result = await fn();
      if (this.state !== 'CLOSED') {
        this.logger.info('[circuit] Banco recuperado — estado → CLOSED');
      }
      this.failures = 0;
      this.state    = 'CLOSED';
      return result;
    } catch(e) {
      if (TRANSIENT_CODES.has(e.code)) {
        this.failures++;
        const shouldOpen = this.failures >= this.threshold || this.state === 'HALF_OPEN';
        if (shouldOpen) {
          this.state       = 'OPEN';
          this.nextAttempt = Date.now() + this.halfOpenMs;
          this.logger.warn('[circuit] Estado → OPEN', {
            failures: this.failures, nextRetryMs: this.halfOpenMs,
          });
        }
      }
      throw e;
    }
  }

  get isOpen()     { return this.state === 'OPEN' && Date.now() < this.nextAttempt; }
  get isClosed()   { return this.state === 'CLOSED'; }
  get isHalfOpen() { return this.state === 'HALF_OPEN'; }

  toJSON() { return { state: this.state, failures: this.failures }; }
}

module.exports = CircuitBreaker;
