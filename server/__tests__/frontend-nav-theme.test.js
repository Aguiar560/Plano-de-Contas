'use strict';

/**
 * frontend-nav-theme.test.js — Dark mode e branding (nav.js)
 *
 * Cobre: _applyTheme, toggleDarkMode, _getBrandingValues
 */

const { createDom } = require('./frontend-helpers');

const HTML = `<!DOCTYPE html>
<html data-theme="light">
<head></head>
<body>
  <div id="sidebarAppTitle"></div>
  <div id="sidebarCompanyName"></div>
  <div id="companyPillName"></div>
  <div id="loginTitle"></div>
  <div id="loginSubtitle"></div>
  <div id="welcomeTitle"></div>
  <input id="cfgEmpresaNome" />
  <input id="cfgSistemaNome" />
  <button id="btnSalvarIdentidade"></button>
  <button id="btnDarkToggle"></button>
  <button id="btnAbrirUsuarios"></button>
  <button id="btnGerenciarUsuarios"></button>
  <button id="btnAbrirAuditLogs"></button>
  <button id="btnAbrirPermissoes"></button>
  <button id="btnExportXMLConfig"></button>
  <button id="btnExportXML"></button>
</body>
</html>`;

let W;

beforeAll(() => {
  const dom = createDom(['nav.js'], HTML);
  W = dom.window;
});

beforeEach(() => {
  // Reseta tema e localStorage antes de cada teste
  W.document.documentElement.setAttribute('data-theme', 'light');
  W.localStorage.clear?.() || (() => {
    for (const k of Object.keys(W.localStorage)) {
      if (typeof W.localStorage[k] !== 'function') delete W.localStorage[k];
    }
  })();
});

// ── _applyTheme ───────────────────────────────────────────────────────────

describe('_applyTheme', () => {
  test('_applyTheme(true) define data-theme="dark"', () => {
    W._applyTheme(true);
    expect(W.document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('_applyTheme(false) define data-theme="light"', () => {
    W._applyTheme(false);
    expect(W.document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('_applyTheme(true) salva "dark" no localStorage', () => {
    W._applyTheme(true);
    expect(W.localStorage.getItem('theme')).toBe('dark');
  });

  test('_applyTheme(false) salva "light" no localStorage', () => {
    W._applyTheme(false);
    expect(W.localStorage.getItem('theme')).toBe('light');
  });
});

// ── toggleDarkMode ────────────────────────────────────────────────────────

describe('toggleDarkMode', () => {
  test('ativa dark mode quando estava em light', () => {
    W.document.documentElement.setAttribute('data-theme', 'light');
    W.toggleDarkMode();
    expect(W.document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('desativa dark mode quando estava em dark', () => {
    W.document.documentElement.setAttribute('data-theme', 'dark');
    W.toggleDarkMode();
    expect(W.document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('duas alternâncias voltam ao estado original', () => {
    W.document.documentElement.setAttribute('data-theme', 'light');
    W.toggleDarkMode();
    W.toggleDarkMode();
    expect(W.document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('localStorage é persistido após toggle', () => {
    W.document.documentElement.setAttribute('data-theme', 'light');
    W.toggleDarkMode();
    expect(W.localStorage.getItem('theme')).toBe('dark');
  });
});

// ── _getBrandingValues ────────────────────────────────────────────────────

describe('_getBrandingValues', () => {
  test('sem localStorage, retorna defaults não-vazios', () => {
    const { product } = W._getBrandingValues();
    expect(typeof product).toBe('string');
    expect(product.length).toBeGreaterThan(0);
  });

  test('lê company do localStorage', () => {
    W.localStorage.setItem('plano_branding_company', 'Patrimônio da Mata');
    expect(W._getBrandingValues().company).toBe('Patrimônio da Mata');
  });

  test('lê product do localStorage', () => {
    W.localStorage.setItem('plano_branding_product', 'MeuSistema');
    expect(W._getBrandingValues().product).toBe('MeuSistema');
  });

  test('BRANDING global é fallback quando localStorage vazio', () => {
    W.BRANDING = { product: 'BrandTeste', company: 'EmpresaTeste' };
    const { product, company } = W._getBrandingValues();
    expect(product).toBe('BrandTeste');
    expect(company).toBe('EmpresaTeste');
    W.BRANDING = undefined;
  });

  test('localStorage tem precedência sobre BRANDING global', () => {
    W.BRANDING = { product: 'GlobalBrand', company: '' };
    W.localStorage.setItem('plano_branding_product', 'LocalProduct');
    expect(W._getBrandingValues().product).toBe('LocalProduct');
    W.BRANDING = undefined;
  });
});
