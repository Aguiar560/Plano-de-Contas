'use strict';

/**
 * frontend-auth-permissions.test.js — Matriz de permissões de auth.js
 *
 * Cobre: ROLES, PERMISSIONS, getPerfilPadrao, getPermissoesEfetivas
 */

const { createDom } = require('./frontend-helpers');

let W;

beforeAll(() => {
  const dom = createDom(['auth.js']);
  W = dom.window;
  // Stub de crypto.subtle para pbkdf2Hex (não é testado aqui mas evita erro)
  W.crypto = {
    getRandomValues: (arr) => { arr.fill(0); return arr; },
    subtle: {
      importKey: jest.fn().mockResolvedValue({}),
      deriveBits: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
      digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  };
});

beforeEach(() => {
  W.localStorage.clear?.();
});

// ── ROLES ─────────────────────────────────────────────────────────────────

describe('ROLES', () => {
  const perfis = ['admin', 'gerente', 'operador', 'visualizador'];

  test.each(perfis)('perfil "%s" tem label, color e badge', (p) => {
    expect(typeof W.ROLES[p].label).toBe('string');
    expect(typeof W.ROLES[p].color).toBe('string');
    expect(typeof W.ROLES[p].badge).toBe('string');
  });
});

// ── PERMISSIONS ───────────────────────────────────────────────────────────

describe('PERMISSIONS — matriz de permissões', () => {
  const perfis = ['admin', 'gerente', 'operador', 'visualizador'];

  test('todas as ações têm booleanos para todos os perfis', () => {
    for (const [, mapa] of Object.entries(W.PERMISSIONS)) {
      for (const p of perfis) {
        expect(typeof mapa[p]).toBe('boolean');
      }
    }
  });

  test('admin tem todas as permissões', () => {
    for (const [, mapa] of Object.entries(W.PERMISSIONS)) {
      expect(mapa.admin).toBe(true);
    }
  });

  test('visualizador: exportData e viewReports true; resto false', () => {
    const P = W.PERMISSIONS;
    expect(P.exportData.visualizador).toBe(true);
    expect(P.viewReports.visualizador).toBe(true);
    expect(P.newLancamento.visualizador).toBe(false);
    expect(P.addConta.visualizador).toBe(false);
    expect(P.manageUsers.visualizador).toBe(false);
  });

  test('operador pode criar e editar lançamentos, mas não remover', () => {
    const P = W.PERMISSIONS;
    expect(P.newLancamento.operador).toBe(true);
    expect(P.editLancamento.operador).toBe(true);
    expect(P.removeLancamento.operador).toBe(false);
  });

  test('gerente pode addConta mas não gerenciar usuários', () => {
    const P = W.PERMISSIONS;
    expect(P.addConta.gerente).toBe(true);
    expect(P.manageUsers.gerente).toBe(false);
  });

  test('removeConta é exclusivo de admin', () => {
    const P = W.PERMISSIONS;
    expect(P.removeConta.admin).toBe(true);
    ['gerente', 'operador', 'visualizador'].forEach(p =>
      expect(P.removeConta[p]).toBe(false)
    );
  });
});

// ── getPerfilPadrao ───────────────────────────────────────────────────────

describe('auth.getPerfilPadrao', () => {
  test('admin tem tudo true', () => {
    const padrao = W.auth.getPerfilPadrao('admin');
    for (const v of Object.values(padrao)) expect(v).toBe(true);
  });

  test('visualizador: exportData/viewReports true; newLancamento false', () => {
    const padrao = W.auth.getPerfilPadrao('visualizador');
    expect(padrao.exportData).toBe(true);
    expect(padrao.viewReports).toBe(true);
    expect(padrao.newLancamento).toBe(false);
  });

  test('cobre todas as ações de PERMISSIONS', () => {
    const padrao = W.auth.getPerfilPadrao('gerente');
    for (const acao of Object.keys(W.PERMISSIONS)) {
      expect(padrao).toHaveProperty(acao);
    }
  });

  test('retorna apenas booleanos', () => {
    for (const v of Object.values(W.auth.getPerfilPadrao('operador'))) {
      expect(typeof v).toBe('boolean');
    }
  });
});

// ── getPermissoesEfetivas ─────────────────────────────────────────────────

describe('auth.getPermissoesEfetivas', () => {
  const KEY = 'plano_user_perms_v2';

  test('sem overrides, retorna padrão do perfil', () => {
    const ef = W.auth.getPermissoesEfetivas(1, 'visualizador');
    expect(ef.exportData).toBe(true);
    expect(ef.newLancamento).toBe(false);
  });

  test('override true sobrepõe padrão false', () => {
    W.localStorage.setItem(KEY, JSON.stringify({ 1: { newLancamento: true } }));
    const ef = W.auth.getPermissoesEfetivas(1, 'visualizador');
    expect(ef.newLancamento).toBe(true);
  });

  test('override false sobrepõe padrão true', () => {
    W.localStorage.setItem(KEY, JSON.stringify({ 2: { exportData: false } }));
    const ef = W.auth.getPermissoesEfetivas(2, 'admin');
    expect(ef.exportData).toBe(false);
  });

  test('override de outro userId não se aplica', () => {
    W.localStorage.setItem(KEY, JSON.stringify({ 99: { newLancamento: true } }));
    const ef = W.auth.getPermissoesEfetivas(1, 'visualizador');
    expect(ef.newLancamento).toBe(false);
  });

  test('localStorage corrompido não quebra', () => {
    W.localStorage.setItem(KEY, 'INVALID{{JSON');
    expect(() => W.auth.getPermissoesEfetivas(1, 'operador')).not.toThrow();
  });
});
