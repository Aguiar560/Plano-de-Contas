'use strict';

/**
 * frontend-report-calc.test.js — Funções de cálculo de relatórios (report.js)
 *
 * Cobre: coletarLancamentosReais, coletarContas, calcularTotalConta
 */

const { createDom } = require('./frontend-helpers');

let W;

beforeAll(() => {
  // report.js referencia elementos DOM no top-level (todos retornam null = ok)
  const dom = createDom(['app.js', 'report.js']);
  W = dom.window;
});

// ── Fixture ───────────────────────────────────────────────────────────────

function criarArvore() {
  const root     = new W.ContaGerencial('');
  const entradas = new W.ContaGerencial('ENTRADAS');
  const saidas   = new W.ContaGerencial('SAIDAS');
  const receita  = new W.ContaGerencial('RECEITAS');
  const despesa  = new W.ContaGerencial('DESPESAS');
  root.addChild(entradas);
  root.addChild(saidas);
  entradas.addChild(receita);
  saidas.addChild(despesa);

  const l1 = new W.Lancamento('credito', 1000, 'Doação Jan', '2026-01-15');
  const l2 = new W.Lancamento('credito',  500, 'Doação Mar', '2026-03-10');
  const l3 = new W.Lancamento('debito',   200, 'Devolução',  '2026-02-20');
  receita.lancamentos = [l1, l2, l3];

  const l4 = new W.Lancamento('debito', 300, 'Combustível', '2026-01-20');
  despesa.lancamentos = [l4];

  return { root, entradas, saidas, receita, despesa };
}

// ── coletarLancamentosReais ───────────────────────────────────────────────

describe('coletarLancamentosReais', () => {
  test('retorna todos os lançamentos do período', () => {
    const { root } = criarArvore();
    const dtI = new W.Date('2026-01-01T00:00:00');
    const dtF = new W.Date('2026-12-31T23:59:59');
    const lista = W.coletarLancamentosReais(root, dtI, dtF);
    expect(lista).toHaveLength(4);
  });

  test('filtra fora do período', () => {
    const { root } = criarArvore();
    const dtI = new W.Date('2026-01-01T00:00:00');
    const dtF = new W.Date('2026-01-31T23:59:59');
    const lista = W.coletarLancamentosReais(root, dtI, dtF);
    expect(lista).toHaveLength(2); // Jan-15 e Jan-20
  });

  test('crédito → valor positivo; débito → valor negativo', () => {
    const { root } = criarArvore();
    const dtI = new W.Date('2026-01-01T00:00:00');
    const dtF = new W.Date('2026-12-31T23:59:59');
    const lista = W.coletarLancamentosReais(root, dtI, dtF);
    lista.filter(l => l.tipo === 'credito').forEach(l => expect(l.valor).toBeGreaterThan(0));
    lista.filter(l => l.tipo === 'debito').forEach( l => expect(l.valor).toBeLessThan(0));
  });

  test('sem lançamentos no período → lista vazia', () => {
    const { root } = criarArvore();
    const dtI = new W.Date('2020-01-01T00:00:00');
    const dtF = new W.Date('2020-12-31T23:59:59');
    expect(W.coletarLancamentosReais(root, dtI, dtF)).toHaveLength(0);
  });

  test('item inclui referência à conta', () => {
    const { root, receita } = criarArvore();
    const dtI = new W.Date('2026-01-01T00:00:00');
    const dtF = new W.Date('2026-12-31T23:59:59');
    const lista = W.coletarLancamentosReais(root, dtI, dtF);
    const item = lista.find(l => l.descricao === 'Doação Jan');
    expect(item.conta).toBe(receita);
  });
});

// ── coletarContas ─────────────────────────────────────────────────────────

describe('coletarContas', () => {
  test('achata a árvore incluindo a raiz', () => {
    const { root } = criarArvore();
    expect(W.coletarContas(root)).toHaveLength(5); // root + 4
  });

  test('conta folha retorna lista com ela mesma', () => {
    const c = new W.ContaGerencial('FOLHA');
    expect(W.coletarContas(c)).toEqual([c]);
  });

  test('inclui todos os nós intermediários', () => {
    const { root, entradas, saidas, receita, despesa } = criarArvore();
    const lista = W.coletarContas(root);
    [entradas, saidas, receita, despesa].forEach(c => expect(lista).toContain(c));
  });
});

// ── calcularTotalConta ────────────────────────────────────────────────────

describe('calcularTotalConta', () => {
  test('soma lançamentos diretos', () => {
    const { receita } = criarArvore();
    const dtI = new W.Date('2026-01-01T00:00:00');
    const dtF = new W.Date('2026-12-31T23:59:59');
    const lancs = W.coletarLancamentosReais(receita, dtI, dtF);
    const total = W.calcularTotalConta(receita, lancs);
    // credito 1000 + 500 - debito 200 = 1300
    expect(total).toBeCloseTo(1300, 2);
  });

  test('inclui lançamentos dos filhos recursivamente', () => {
    const { entradas } = criarArvore();
    const dtI = new W.Date('2026-01-01T00:00:00');
    const dtF = new W.Date('2026-12-31T23:59:59');
    const lancs = W.coletarLancamentosReais(entradas, dtI, dtF);
    expect(W.calcularTotalConta(entradas, lancs)).toBeCloseTo(1300, 2);
  });

  test('conta sem lançamentos → 0', () => {
    const c = new W.ContaGerencial('VAZIA');
    expect(W.calcularTotalConta(c, [])).toBe(0);
  });

  test('lançamentos de outras contas são ignorados', () => {
    const a = new W.ContaGerencial('A');
    const b = new W.ContaGerencial('B');
    const lancA = { conta: a, valor: 100 };
    const lancB = { conta: b, valor: 200 };
    expect(W.calcularTotalConta(a, [lancA, lancB])).toBe(100);
  });
});
