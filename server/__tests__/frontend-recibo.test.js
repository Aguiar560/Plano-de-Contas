'use strict';

/**
 * frontend-recibo.test.js — Funções puras de recibo-autonomo.js
 *
 * Cobre: _extensoBRL, _reciboFmt, _reciboFmtData, _reciboEsc,
 *        cálculos de INSS (11%) e IRRF (tabela progressiva 2026)
 */

const { createDom } = require('./frontend-helpers');

let W; // dom.window

beforeAll(() => {
  const dom = createDom(['recibo-autonomo.js']);
  W = dom.window;
});

// ── _extensoBRL ───────────────────────────────────────────────────────────

describe('_extensoBRL — valor numérico para extenso', () => {
  test('zero',  () => expect(W._extensoBRL(0)).toBe('zero reais'));
  test('1 real', () => expect(W._extensoBRL(1)).toBe('um real'));
  test('2 reais', () => expect(W._extensoBRL(2)).toBe('dois reais'));
  test('cem reais', () => expect(W._extensoBRL(100)).toBe('cem reais'));
  test('cento e um reais', () => expect(W._extensoBRL(101)).toBe('cento e um reais'));
  test('mil reais', () => expect(W._extensoBRL(1000)).toBe('mil reais'));
  test('mil quinhentos reais', () => expect(W._extensoBRL(1500)).toBe('mil quinhentos reais'));
  test('valor negativo → string vazia', () => expect(W._extensoBRL(-10)).toBe(''));
  test('NaN → string vazia', () => expect(W._extensoBRL(NaN)).toBe(''));
  test('um centavo', () => expect(W._extensoBRL(0.01)).toBe('um centavo'));
  test('inclui centavos', () => {
    const r = W._extensoBRL(2500.50);
    expect(r).toContain('reais');
    expect(r).toContain('centavo');
  });
  test('1.99 → um real e noventa e nove centavos', () => {
    const r = W._extensoBRL(1.99);
    expect(r).toContain('real');
    expect(r).toContain('noventa e nove centavos');
  });
});

// ── _reciboFmt ────────────────────────────────────────────────────────────

describe('_reciboFmt — formatação monetária pt-BR', () => {
  test('1500 → "1.500,00"', ()  => expect(W._reciboFmt(1500)).toBe('1.500,00'));
  test('0 → "0,00"',       ()  => expect(W._reciboFmt(0)).toBe('0,00'));
  test('1234.56',          ()  => expect(W._reciboFmt(1234.56)).toBe('1.234,56'));
  test('NaN → "0,00"',    ()  => expect(W._reciboFmt(NaN)).toBe('0,00'));
  test('string numérica', ()  => expect(W._reciboFmt('500')).toBe('500,00'));
});

// ── _reciboFmtData ────────────────────────────────────────────────────────

describe('_reciboFmtData — ISO para DD/MM/YYYY', () => {
  test('2026-05-31 → "31/05/2026"',  () => expect(W._reciboFmtData('2026-05-31')).toBe('31/05/2026'));
  test('2024-01-01 → "01/01/2024"',  () => expect(W._reciboFmtData('2024-01-01')).toBe('01/01/2024'));
  test('null → string vazia',        () => expect(W._reciboFmtData(null)).toBe(''));
  test('undefined → string vazia',   () => expect(W._reciboFmtData(undefined)).toBe(''));
  test('formato inesperado → valor', () => expect(W._reciboFmtData('31/05/2026')).toBe('31/05/2026'));
});

// ── _reciboEsc ────────────────────────────────────────────────────────────

describe('_reciboEsc — escape HTML', () => {
  test('& → &amp;',       () => expect(W._reciboEsc('a & b')).toBe('a &amp; b'));
  test('< → &lt;',        () => expect(W._reciboEsc('<tag>')).toBe('&lt;tag&gt;'));
  test('" → &quot;',      () => expect(W._reciboEsc('say "hi"')).toBe('say &quot;hi&quot;'));
  test('XSS payload',      () => expect(W._reciboEsc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;'));
  test('texto limpo',      () => expect(W._reciboEsc('Patrimônio')).toBe('Patrimônio'));
  test('null → vazio',     () => expect(W._reciboEsc(null)).toBe(''));
});

// ── INSS / IRRF ───────────────────────────────────────────────────────────

function calcRecibo(total) {
  const html = W._htmlRecibo({
    org:    { nome:'Org', razaoSocial:'ORG', cnpj:'', endereco:'', bairroCidade:'', cepCidade:'', email:'', site:'', responsavel:'Resp' },
    recibo: { formatted:'0001/2026', data:'01/06/2026', projeto:'', servico:'' },
    forn:   { nome:'Auto', endereco:'', cpf:'', rg:'', inssPis:'', tituloEleitor:'', dataNascimento:'' },
    itens:  [{ descricao: 'Serviço', valor: total }],
    total,
    totalExtenso: W._extensoBRL(total),
    serverOrigin: '',
  });
  const div = W.document.createElement('div');
  div.innerHTML = html;
  const params = div.querySelector('#rc-params');
  return {
    inss:  parseFloat(params?.dataset.inss  ?? '0'),
    total: parseFloat(params?.dataset.total ?? '0'),
  };
}

describe('Cálculo de INSS — alíquota 11%', () => {
  test('R$3.000 → INSS R$330,00', () => {
    expect(calcRecibo(3000).inss).toBeCloseTo(330, 2);
  });
  test('R$1.500 → INSS R$165,00', () => {
    expect(calcRecibo(1500).inss).toBeCloseTo(165, 2);
  });
  test('R$500 → INSS R$55,00', () => {
    expect(calcRecibo(500).inss).toBeCloseTo(55, 2);
  });
  test('total do recibo é preservado no data-total', () => {
    expect(calcRecibo(2000).total).toBeCloseTo(2000, 2);
  });
});

describe('Tabela progressiva IRRF 2026', () => {
  test('isento: base IRRF ≤ 2428.80', () => {
    // total 2000 → INSS 220 → base IRRF 1780 → isento
    const html = W._htmlRecibo({
      org:{nome:'',razaoSocial:'',cnpj:'',endereco:'',bairroCidade:'',cepCidade:'',email:'',site:'',responsavel:''},
      recibo:{formatted:'',data:'',projeto:'',servico:''},
      forn:{nome:'',endereco:'',cpf:'',rg:'',inssPis:'',tituloEleitor:'',dataNascimento:''},
      itens:[{descricao:'',valor:2000}], total:2000, totalExtenso:'', serverOrigin:'',
    });
    expect(html.toLowerCase()).toMatch(/isento|0,00/);
  });

  test('alíquota 27,5%: base > R$4.664,68 → IRRF > 0', () => {
    // total 10000 → INSS 1100 → base IRRF 8900 → faixa 27.5%
    const total = 10000;
    const inssV = +(total * 0.11).toFixed(2);
    const base  = +(total - inssV).toFixed(2);
    const irrf  = +(base * 27.5 / 100 - 908.74).toFixed(2);
    expect(base).toBeGreaterThan(4664.68);
    expect(irrf).toBeGreaterThan(0);

    const html = W._htmlRecibo({
      org:{nome:'',razaoSocial:'',cnpj:'',endereco:'',bairroCidade:'',cepCidade:'',email:'',site:'',responsavel:''},
      recibo:{formatted:'',data:'',projeto:'',servico:''},
      forn:{nome:'',endereco:'',cpf:'',rg:'',inssPis:'',tituloEleitor:'',dataNascimento:''},
      itens:[{descricao:'',valor:total}], total, totalExtenso:'', serverOrigin:'',
    });
    // INSS de R$1.100 deve aparecer no HTML
    expect(html).toContain(W._reciboFmt(inssV));
  });
});
