'use strict';

/**
 * circuit-breaker.test.js — Testes unitários do CircuitBreaker.
 *
 * Testa a máquina de estados: CLOSED → OPEN → HALF_OPEN → CLOSED / OPEN.
 * Sem I/O real — fn é sempre um jest.fn().
 */

const CircuitBreaker = require('../circuit-breaker');

function makeBreaker(opts = {}) {
  return new CircuitBreaker({
    failureThreshold: 3,
    halfOpenMs: 200, // 200ms para testes rápidos
    logger: { warn: jest.fn(), info: jest.fn() },
    ...opts,
  });
}

function transientError(code = 'ECONNREFUSED') {
  const e = new Error('simulated');
  e.code = code;
  return e;
}

// ── Estado CLOSED (operação normal) ──────────────────────────────────────

describe('CLOSED state', () => {
  test('retorna resultado quando fn resolve', async () => {
    const cb = makeBreaker();
    const result = await cb.call(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(cb.isClosed).toBe(true);
  });

  test('propaga erro não-transiente sem incrementar falhas', async () => {
    const cb = makeBreaker();
    const sqlErr = new Error('ER_BAD_FIELD_ERROR');
    sqlErr.code = 'ER_BAD_FIELD_ERROR';
    await expect(cb.call(() => Promise.reject(sqlErr))).rejects.toThrow('ER_BAD_FIELD_ERROR');
    expect(cb.failures).toBe(0);
    expect(cb.isClosed).toBe(true);
  });

  test('incrementa failures em erros transientes', async () => {
    const cb = makeBreaker();
    await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    expect(cb.failures).toBe(1);
    expect(cb.isClosed).toBe(true);
  });

  test('reseta failures após sucesso', async () => {
    const cb = makeBreaker();
    await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    await cb.call(() => Promise.resolve('ok'));
    expect(cb.failures).toBe(0);
    expect(cb.isClosed).toBe(true);
  });
});

// ── Transição CLOSED → OPEN ───────────────────────────────────────────────

describe('CLOSED → OPEN transition', () => {
  test('abre o circuito após failureThreshold erros transientes', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    }
    expect(cb.isOpen).toBe(true);
    expect(cb.state).toBe('OPEN');
  });

  test('em estado OPEN lança imediatamente sem chamar fn', async () => {
    const cb = makeBreaker({ failureThreshold: 2, halfOpenMs: 60_000 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    }
    expect(cb.isOpen).toBe(true);

    const fn = jest.fn().mockResolvedValue('nunca');
    await expect(cb.call(fn)).rejects.toMatchObject({ code: 'ECIRCUIT' });
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── Transição OPEN → HALF_OPEN → CLOSED ──────────────────────────────────

describe('OPEN → HALF_OPEN → CLOSED (recovery)', () => {
  test('entra em HALF_OPEN após halfOpenMs e fecha com sucesso', async () => {
    const cb = makeBreaker({ failureThreshold: 2, halfOpenMs: 50 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    }
    expect(cb.state).toBe('OPEN');

    // Aguarda o halfOpenMs expirar
    await new Promise(r => setTimeout(r, 60));

    expect(cb.isOpen).toBe(false); // next attempt permitido

    const result = await cb.call(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(cb.state).toBe('CLOSED');
    expect(cb.failures).toBe(0);
  });
});

// ── Transição HALF_OPEN → OPEN (falha na sonda) ───────────────────────────

describe('HALF_OPEN → OPEN (probe fails)', () => {
  test('reabre o circuito se a sonda em HALF_OPEN falhar', async () => {
    const cb = makeBreaker({ failureThreshold: 2, halfOpenMs: 50 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    }
    expect(cb.state).toBe('OPEN');

    await new Promise(r => setTimeout(r, 60));

    // Sonda falha
    await expect(cb.call(() => Promise.reject(transientError()))).rejects.toBeDefined();
    expect(cb.state).toBe('OPEN'); // reabriu
  });
});

// ── toJSON ────────────────────────────────────────────────────────────────

describe('toJSON', () => {
  test('retorna state e failures', () => {
    const cb = makeBreaker();
    expect(cb.toJSON()).toEqual({ state: 'CLOSED', failures: 0 });
  });
});
