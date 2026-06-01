'use strict';

/**
 * frontend-app-model.test.js — Classes de modelo de app.js
 *
 * Cobre: Lancamento, ContaGerencial (estrutura de árvore + getters),
 *        PlanoContasRepository (_toJSON/_fromJSON, alertaOrcamento, saldos)
 */

const { createDom } = require('./frontend-helpers');

let W;

beforeAll(() => {
  const dom = createDom(['app.js']);
  W = dom.window;
});

// ── Lancamento ────────────────────────────────────────────────────────────

describe('class Lancamento', () => {
  test('tipo, valor e descrição (com trim)', () => {
    const l = new W.Lancamento('credito', 500, ' Receita ');
    expect(l.tipo).toBe('credito');
    expect(l.valor).toBe(500);
    expect(l.descricao).toBe('Receita');
  });

  test('data padrão é hoje ISO', () => {
    const l = new W.Lancamento('debito', 100, 'X');
    expect(l.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('data personalizada é preservada', () => {
    const l = new W.Lancamento('credito', 200, 'X', '2026-01-15');
    expect(l.data).toBe('2026-01-15');
  });

  test('ids são únicos e crescentes', () => {
    const a = new W.Lancamento('credito', 1, 'A');
    const b = new W.Lancamento('credito', 1, 'B');
    expect(b.id).toBeGreaterThan(a.id);
  });
});

// ── ContaGerencial ────────────────────────────────────────────────────────

describe('class ContaGerencial — árvore', () => {
  function mk(n) { return new W.ContaGerencial(n); }

  test('nome é normalizado para maiúsculas', () =>
    expect(mk('caixa').nome).toBe('CAIXA'));

  test('addChild liga parent/firstChild', () => {
    const root = mk('R'); const filho = mk('F');
    root.addChild(filho);
    expect(root.firstChild).toBe(filho);
    expect(filho.parent).toBe(root);
  });

  test('children retorna array com filhos diretos', () => {
    const root = mk('R');
    const a = mk('A'), b = mk('B'), c = mk('C');
    root.addChild(a); root.addChild(b); root.addChild(c);
    expect(root.children).toEqual([a, b, c]);
  });

  test('hasChildren false/true', () => {
    const r = mk('R');
    expect(r.hasChildren).toBe(false);
    r.addChild(mk('F'));
    expect(r.hasChildren).toBe(true);
  });

  test('removeChild do meio', () => {
    const root = mk('R');
    const a = mk('A'), b = mk('B'), c = mk('C');
    root.addChild(a); root.addChild(b); root.addChild(c);
    root.removeChild(b);
    expect(root.children).toEqual([a, c]);
    expect(b.parent).toBeNull();
  });

  test('removeChild do primeiro', () => {
    const root = mk('R');
    const a = mk('A'), b = mk('B');
    root.addChild(a); root.addChild(b);
    root.removeChild(a);
    expect(root.firstChild).toBe(b);
  });

  test('nivel: neto está no nível 3', () => {
    const root = mk('R'), filho = mk('F'), neto = mk('N');
    root.addChild(filho); filho.addChild(neto);
    expect(root.nivel).toBe(1);
    expect(filho.nivel).toBe(2);
    expect(neto.nivel).toBe(3);
  });

  test('caminho usa › como separador', () => {
    const root = mk('ENTRADAS'), filho = mk('PROJETOS');
    root.addChild(filho);
    expect(filho.caminho).toBe('ENTRADAS › PROJETOS');
  });

  test('tipo "Entrada" a partir do ancestral ENTRADAS', () => {
    const treeRoot = new W.ContaGerencial('');
    const entradas = mk('ENTRADAS'), sub = mk('DOAÇÕES');
    treeRoot.addChild(entradas); entradas.addChild(sub);
    expect(sub.tipo).toBe('Entrada');
  });

  test('tipo "Saída" a partir do ancestral SAIDAS', () => {
    const treeRoot = new W.ContaGerencial('');
    const saidas = mk('SAIDAS'), sub = mk('COMBUSTÍVEL');
    treeRoot.addChild(saidas); saidas.addChild(sub);
    expect(sub.tipo).toBe('Saída');
  });

  test('saldo soma lançamentos', () => {
    const c = mk('X');
    c.lancamentos = [{ valor: 100 }, { valor: 200 }, { valor: -50 }];
    expect(c.saldo).toBe(250);
  });

  test('totalDescendants conta todos os nós abaixo', () => {
    const root = mk('R'), a = mk('A'), b = mk('B'), c = mk('C');
    root.addChild(a); root.addChild(b); b.addChild(c);
    expect(root.totalDescendants).toBe(3);
  });

  test('insertChildBefore insere antes do ref', () => {
    const root = mk('R'), a = mk('A'), b = mk('B'), x = mk('X');
    root.addChild(a); root.addChild(b);
    root.insertChildBefore(x, b);
    expect(root.children.map(c => c.nome)).toEqual(['A', 'X', 'B']);
  });

  test('insertChildAfter insere depois do ref', () => {
    const root = mk('R'), a = mk('A'), b = mk('B'), x = mk('X');
    root.addChild(a); root.addChild(b);
    root.insertChildAfter(x, a);
    expect(root.children.map(c => c.nome)).toEqual(['A', 'X', 'B']);
  });
});

// ── PlanoContasRepository — serialização ─────────────────────────────────

describe('_toJSON / _fromJSON roundtrip', () => {
  function makeRepo() {
    const repo = new W.PlanoContasRepository();
    repo._root = new W.ContaGerencial('');
    const entradas = new W.ContaGerencial('ENTRADAS');
    const c1 = new W.ContaGerencial('DOAÇÕES');
    repo._root.addChild(entradas);
    entradas.addChild(c1);
    const lanc = new W.Lancamento('credito', 500, 'Doação', '2026-05-01');
    lanc.db_id = 42;
    c1.lancamentos.push(lanc);
    return { repo, c1 };
  }

  test('roundtrip preserva estrutura', () => {
    const { repo } = makeRepo();
    const json = repo._toJSON(repo._root);
    const restored = repo._fromJSON(json, null);
    expect(restored.firstChild?.nome).toBe('ENTRADAS');
    expect(restored.firstChild?.firstChild?.nome).toBe('DOAÇÕES');
  });

  test('_fromJSON ignora lançamentos sem db_id (phantoms)', () => {
    const { repo, c1 } = makeRepo();
    const phantom = new W.Lancamento('credito', 999, 'Fantasma', '2026-05-01');
    // db_id não definido
    c1.lancamentos.push(phantom);

    const json = repo._toJSON(repo._root);
    const restored = repo._fromJSON(json, null);
    const lancs = restored.firstChild.firstChild.lancamentos;
    expect(lancs).toHaveLength(1);
    expect(lancs[0].db_id).toBe(42);
  });

  test('_fromJSON preserva db_id e valor', () => {
    const { repo } = makeRepo();
    const json = repo._toJSON(repo._root);
    const restored = repo._fromJSON(json, null);
    const l = restored.firstChild.firstChild.lancamentos[0];
    expect(l.db_id).toBe(42);
    expect(l.valor).toBe(500);
  });
});

// ── PlanoContasRepository — cálculos financeiros ─────────────────────────

describe('PlanoContasRepository — saldo e orçamento', () => {
  let repo;

  beforeEach(() => {
    repo = new W.PlanoContasRepository();
  });

  test('saldoDireto: crédito positivo, débito negativo', () => {
    const c = new W.ContaGerencial('X');
    c.lancamentos = [{ tipo:'credito', valor:500 }, { tipo:'debito', valor:200 }];
    expect(repo.saldoDireto(c)).toBe(300);
  });

  test('saldoAcumulado inclui filhos recursivamente', () => {
    const pai = new W.ContaGerencial('PAI');
    const filho = new W.ContaGerencial('FILHO');
    pai.addChild(filho);
    pai.lancamentos   = [{ tipo:'credito', valor:100 }];
    filho.lancamentos = [{ tipo:'credito', valor:50 }];
    expect(repo.saldoAcumulado(pai)).toBe(150);
  });

  test('realizadoOrcamento: soma absoluta incluindo filhos', () => {
    const c = new W.ContaGerencial('S');
    c.orcamento = 1000;
    c.lancamentos = [{ tipo:'debito', valor:300 }, { tipo:'debito', valor:200 }];
    expect(repo.realizadoOrcamento(c)).toBe(500);
  });

  test('alertaOrcamento: null sem orçamento', () => {
    const c = new W.ContaGerencial('X');
    c.orcamento = 0;
    expect(repo.alertaOrcamento(c)).toBeNull();
  });

  test('alertaOrcamento: "ok" quando < 80%', () => {
    const c = new W.ContaGerencial('X');
    c.orcamento = 1000;
    c.lancamentos = [{ tipo:'debito', valor:700 }];
    expect(repo.alertaOrcamento(c)).toBe('ok');
  });

  test('alertaOrcamento: "atencao" quando > 80%', () => {
    const c = new W.ContaGerencial('X');
    c.orcamento = 1000;
    c.lancamentos = [{ tipo:'debito', valor:850 }];
    expect(repo.alertaOrcamento(c)).toBe('atencao');
  });

  test('alertaOrcamento: "excedido" quando > 100%', () => {
    const c = new W.ContaGerencial('X');
    c.orcamento = 1000;
    c.lancamentos = [{ tipo:'debito', valor:1100 }];
    expect(repo.alertaOrcamento(c)).toBe('excedido');
  });

  test('percentualOrcamento: 50% quando realizado = 500 de 1000', () => {
    const c = new W.ContaGerencial('X');
    c.orcamento = 1000;
    c.lancamentos = [{ tipo:'debito', valor:500 }];
    expect(repo.percentualOrcamento(c)).toBeCloseTo(50, 1);
  });

  test('percentualOrcamento: null se orcamento = 0', () => {
    const c = new W.ContaGerencial('X');
    c.orcamento = 0;
    expect(repo.percentualOrcamento(c)).toBeNull();
  });
});
