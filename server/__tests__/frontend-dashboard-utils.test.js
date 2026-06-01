'use strict';

/**
 * frontend-dashboard-utils.test.js — Utilitários de dashboard.js
 *
 * Cobre: _fmtMoeda, _fmtMoedaCompact, _fmtData, _esc,
 *        _isoFirstOfMonth, _isoLastOfMonth, _applyPeriod
 */

const { JSDOM } = require('jsdom');
const fs   = require('fs');
const path = require('path');

// Dashboard.js precisa de inputs dashDtI e dashDtF no DOM
const HTML = `<!DOCTYPE html><html><body>
  <input id="dashDtI" />
  <input id="dashDtF" />
  <div id="view-dashboard"></div>
</body></html>`;

let W, dom;

beforeAll(() => {
  const { createDom } = require('./frontend-helpers');
  dom = createDom(['app.js', 'dashboard.js'], HTML);
  W = dom.window;
  W.repo = null;
});

// ── _fmtMoeda ─────────────────────────────────────────────────────────────

describe('_fmtMoeda', () => {
  test('1500 → "R$ 1.500,00"',  () => expect(W._fmtMoeda(1500)).toBe('R$ 1.500,00'));
  test('0 → "R$ 0,00"',         () => expect(W._fmtMoeda(0)).toBe('R$ 0,00'));
  test('negativo usa abs',       () => expect(W._fmtMoeda(-250)).toBe('R$ 250,00'));
  test('1234.56 → "R$ 1.234,56"', () => expect(W._fmtMoeda(1234.56)).toBe('R$ 1.234,56'));
});

// ── _fmtMoedaCompact ──────────────────────────────────────────────────────

describe('_fmtMoedaCompact', () => {
  test('< 1000 → valor completo',   () => expect(W._fmtMoedaCompact(500)).toBe('R$ 500'));
  test('1000 → "R$ 1k"',            () => expect(W._fmtMoedaCompact(1000)).toBe('R$ 1k'));
  test('1000000 → "R$ 1.0M"',       () => expect(W._fmtMoedaCompact(1000000)).toBe('R$ 1.0M'));
  test('2500000 → "R$ 2.5M"',       () => expect(W._fmtMoedaCompact(2500000)).toBe('R$ 2.5M'));
  test('resultado contém R$',        () => expect(W._fmtMoedaCompact(2500)).toMatch(/^R\$/));
});

// ── _fmtData ──────────────────────────────────────────────────────────────

describe('_fmtData', () => {
  test('2026-05-31 → "31/05/2026"', () => expect(W._fmtData('2026-05-31')).toBe('31/05/2026'));
  test('2024-01-01 → "01/01/2024"', () => expect(W._fmtData('2024-01-01')).toBe('01/01/2024'));
  test('null → "—"',                () => expect(W._fmtData(null)).toBe('—'));
  test('undefined → "—"',           () => expect(W._fmtData(undefined)).toBe('—'));
  test('string vazia → "—"',        () => expect(W._fmtData('')).toBe('—'));
});

// ── _esc ──────────────────────────────────────────────────────────────────

describe('_esc', () => {
  test('& → &amp;',        () => expect(W._esc('A & B')).toBe('A &amp; B'));
  test('< → &lt;',         () => expect(W._esc('<b>')).toBe('&lt;b&gt;'));
  test('texto limpo',       () => expect(W._esc('Patrimônio')).toBe('Patrimônio'));
  test('null → vazio',      () => expect(W._esc(null)).toBe(''));
});

// ── _isoFirstOfMonth / _isoLastOfMonth ────────────────────────────────────

describe('_isoFirstOfMonth', () => {
  test('maio 2026 → "2026-05-01"', () => {
    expect(W._isoFirstOfMonth(new W.Date(2026, 4, 15))).toBe('2026-05-01');
  });
  test('sem argumento → formato válido "YYYY-MM-01"', () => {
    expect(W._isoFirstOfMonth()).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe('_isoLastOfMonth', () => {
  test('maio 2026 → "2026-05-31"', () => {
    expect(W._isoLastOfMonth(new W.Date(2026, 4, 15))).toBe('2026-05-31');
  });
  test('fevereiro 2024 (bissexto) → "2024-02-29"', () => {
    expect(W._isoLastOfMonth(new W.Date(2024, 1, 5))).toBe('2024-02-29');
  });
  test('fevereiro 2026 (não bissexto) → "2026-02-28"', () => {
    expect(W._isoLastOfMonth(new W.Date(2026, 1, 5))).toBe('2026-02-28');
  });
  test('dezembro tem 31 dias', () => {
    expect(W._isoLastOfMonth(new W.Date(2026, 11, 1))).toBe('2026-12-31');
  });
});

// ── _applyPeriod ──────────────────────────────────────────────────────────

describe('_applyPeriod — cálculo de intervalos de período', () => {
  function getDtI() { return W.document.getElementById('dashDtI')?.value; }

  test('"mes" define dtI no primeiro dia do mês', () => {
    W._applyPeriod('mes');
    expect(getDtI()).toMatch(/^\d{4}-\d{2}-01$/);
  });

  test('"ano" define dtI em 01/01 do ano atual', () => {
    W._applyPeriod('ano');
    const anoAtual = new W.Date().getFullYear();
    expect(getDtI()).toBe(`${anoAtual}-01-01`);
  });

  test('"trimestre" define dtI no primeiro mês do trimestre', () => {
    W._applyPeriod('trimestre');
    const mes = parseInt((getDtI() || '').split('-')[1], 10);
    expect([1, 4, 7, 10]).toContain(mes);
  });

  test('chave inválida não altera os inputs', () => {
    W._applyPeriod('mes');
    const before = getDtI();
    W._applyPeriod('invalido');
    expect(getDtI()).toBe(before); // sem alteração
  });
});
