/**
 * client-parsers.test.js — Testes unitários para funções de parsing do cliente
 *
 * Testa a lógica de parsing de extratos bancários (OFX e CSV) e funções
 * auxiliares de sanitização HTML. As funções são funções puras extraídas
 * de client/ofx-import.js e client/search.js — não dependem do DOM.
 *
 * Cobre:
 *  - _parseOFX: lê blocos STMTTRN, converte datas, determina tipo
 *  - _parseCSV: detecta separador, extrai data/valor/descrição
 *  - escapeHtmlSearch: escape de caracteres HTML especiais
 *  - Matriz de permissões PERMISSIONS: hierarquia admin > gerente > operador > visualizador
 */

'use strict';

// ── Funções extraídas de client/ofx-import.js ─────────────────────────────
// (copiadas aqui pois o arquivo original é um browser script sem module.exports)

function parseOFX(text) {
  const txns = [];
  const blocks = text.replace(/\r\n/g, '\n').match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

  blocks.forEach((block, i) => {
    const get = tag => {
      const m = block.match(new RegExp('<' + tag + '>([^<\\n]+)', 'i'));
      return m ? m[1].trim() : '';
    };

    const trnType  = get('TRNTYPE').toUpperCase();
    const dtPosted = get('DTPOSTED').slice(0, 8);
    const amt      = parseFloat(get('TRNAMT').replace(',', '.'));
    const memo     = get('MEMO') || get('NAME') || '';
    const fitId    = get('FITID') || ('ofx|' + dtPosted + '|' + amt + '|' + memo);

    if (isNaN(amt)) return;

    const tipo  = (amt < 0 || trnType === 'DEBIT' || trnType === 'CHECK') ? 'debito' : 'credito';
    const valor = Math.abs(amt);

    const data = dtPosted.length >= 8
      ? dtPosted.slice(0,4) + '-' + dtPosted.slice(4,6) + '-' + dtPosted.slice(6,8)
      : new Date().toISOString().slice(0,10);

    txns.push({ fitId, tipo, valor, descricao: memo, data, importar: true });
  });

  return txns;
}

function _parseNum(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return NaN;
  const neg = /^-|-$|^\(/.test(s);
  let body = s.replace(/[^\d.,]/g, '');
  if (body.indexOf(',') >= 0) {
    body = body.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(body);
  if (isNaN(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

function parseCSV(text) {
  const txns = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return txns;
  const sep   = lines[0].includes(';') ? ';' : ',';
  const start = /data|date|valor|value|hist|descr/i.test(lines[0]) ? 1 : 0;

  lines.slice(start).forEach((line) => {
    const cols = line.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cols.length < 2) return;

    let data = '';
    const rawDate = cols[0];
    const dmatch  = rawDate.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/);
    if (dmatch) {
      const year = dmatch[3].length === 2 ? '20' + dmatch[3] : dmatch[3];
      data = year + '-' + dmatch[2] + '-' + dmatch[1];
    } else {
      const iso = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
      data = iso ? iso[0] : new Date().toISOString().slice(0,10);
    }

    let valIdx = -1, valor = 0, tipo = 'debito';
    const pick = (pred) => {
      for (let c = 1; c < cols.length; c++) {
        if (!pred(cols[c])) continue;
        const n = _parseNum(cols[c]);
        if (!isNaN(n) && n !== 0) { valIdx = c; valor = Math.abs(n); tipo = n < 0 ? 'debito' : 'credito'; return true; }
      }
      return false;
    };
    if (!pick(s => /[,.\-()]/.test(s))) pick(() => true);

    if (!valor || !data) return;

    const descricao = cols.filter((c, idx) => {
      if (idx === 0 || idx === valIdx) return false;
      const isMoney = /[,.]/.test(c) && !isNaN(_parseNum(c));
      return !isMoney;
    }).join(' ').trim();

    const fitId = 'csv|' + data + '|' + valor + '|' + tipo + '|' + descricao;
    txns.push({ fitId, tipo, valor, descricao, data, importar: true });
  });

  return txns;
}

// ── Função extraída de client/search.js ──────────────────────────────────

function escapeHtmlSearch(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Matriz de permissões (espelhada de client/auth.js) ────────────────────

const PERMISSIONS = {
  addConta:         { admin: true,  gerente: true,  operador: false, visualizador: false },
  renameConta:      { admin: true,  gerente: true,  operador: false, visualizador: false },
  removeConta:      { admin: true,  gerente: false, operador: false, visualizador: false },
  moveConta:        { admin: true,  gerente: true,  operador: false, visualizador: false },
  newLancamento:    { admin: true,  gerente: true,  operador: true,  visualizador: false },
  editLancamento:   { admin: true,  gerente: true,  operador: true,  visualizador: false },
  removeLancamento: { admin: true,  gerente: true,  operador: false, visualizador: false },
  editOrcamento:    { admin: true,  gerente: true,  operador: false, visualizador: false },
  exportData:       { admin: true,  gerente: true,  operador: true,  visualizador: true  },
  viewReports:      { admin: true,  gerente: true,  operador: true,  visualizador: true  },
  viewBalance:      { admin: true,  gerente: true,  operador: true,  visualizador: false },
  manageUsers:      { admin: true,  gerente: false, operador: false, visualizador: false },
};

function can(perfil, acao) {
  const entry = PERMISSIONS[acao];
  if (!entry) return false;
  return entry[perfil] === true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Testes de parseOFX
// ═══════════════════════════════════════════════════════════════════════════

describe('parseOFX — parsing de extratos OFX', () => {
  const OFX_SAMPLE = `
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
  <TRNTYPE>CREDIT</TRNTYPE>
  <DTPOSTED>20260501120000</DTPOSTED>
  <TRNAMT>1500.00</TRNAMT>
  <FITID>20260501001</FITID>
  <MEMO>Salário maio</MEMO>
</STMTTRN>
<STMTTRN>
  <TRNTYPE>DEBIT</TRNTYPE>
  <DTPOSTED>20260510</DTPOSTED>
  <TRNAMT>-350.75</TRNAMT>
  <FITID>20260510002</FITID>
  <MEMO>Aluguel</MEMO>
</STMTTRN>
<STMTTRN>
  <TRNTYPE>CHECK</TRNTYPE>
  <DTPOSTED>20260515</DTPOSTED>
  <TRNAMT>200.00</TRNAMT>
  <FITID>20260515003</FITID>
  <NAME>Cheque 1234</NAME>
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  test('extrai o número correto de transações', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns).toHaveLength(3);
  });

  test('CREDIT com valor positivo → tipo credito', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns[0].tipo).toBe('credito');
    expect(txns[0].valor).toBe(1500.00);
    expect(txns[0].descricao).toBe('Salário maio');
  });

  test('DEBIT com valor negativo → tipo debito', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns[1].tipo).toBe('debito');
    expect(txns[1].valor).toBeCloseTo(350.75);
    expect(txns[1].descricao).toBe('Aluguel');
  });

  test('CHECK → tipo debito independente do valor ser positivo', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns[2].tipo).toBe('debito');
    expect(txns[2].valor).toBe(200.00);
  });

  test('converte YYYYMMDD para YYYY-MM-DD', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns[1].data).toBe('2026-05-10');
  });

  test('DTPOSTED com horário (YYYYMMDDHHMMSS) extrai só a data', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns[0].data).toBe('2026-05-01');
  });

  test('usa NAME quando MEMO está ausente', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns[2].descricao).toBe('Cheque 1234');
  });

  test('importar = true em todas as transações', () => {
    const txns = parseOFX(OFX_SAMPLE);
    txns.forEach(t => expect(t.importar).toBe(true));
  });

  test('OFX vazio retorna array vazio', () => {
    const txns = parseOFX('<OFX></OFX>');
    expect(txns).toEqual([]);
  });

  test('transação com TRNAMT NaN é ignorada', () => {
    const ofx = `<OFX><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260501</DTPOSTED><TRNAMT>abc</TRNAMT><FITID>1</FITID></STMTTRN></OFX>`;
    const txns = parseOFX(ofx);
    expect(txns).toHaveLength(0);
  });

  test('valor negativo com CREDIT → débito (sinal prevalece sobre TRNTYPE)', () => {
    const ofx = `<OFX><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260601</DTPOSTED><TRNAMT>-100.00</TRNAMT><FITID>1</FITID><MEMO>Estorno</MEMO></STMTTRN></OFX>`;
    const txns = parseOFX(ofx);
    expect(txns[0].tipo).toBe('debito');
    expect(txns[0].valor).toBe(100);
  });

  test('múltiplos blocos com quebras CRLF são parseados corretamente', () => {
    const ofxCRLF = OFX_SAMPLE.replace(/\n/g, '\r\n');
    const txns = parseOFX(ofxCRLF);
    expect(txns).toHaveLength(3);
  });

  test('fitId é preservado do OFX', () => {
    const txns = parseOFX(OFX_SAMPLE);
    expect(txns[0].fitId).toBe('20260501001');
  });

  test('sem FITID, gera fitId estável por conteúdo (dedup ao reimportar)', () => {
    const ofx = `<OFX><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260601</DTPOSTED><TRNAMT>-99.90</TRNAMT><MEMO>Tarifa</MEMO></STMTTRN></OFX>`;
    const a = parseOFX(ofx)[0].fitId;
    const b = parseOFX(ofx)[0].fitId;
    expect(a).toBe(b);
    expect(a).toContain('ofx|');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Testes de parseCSV
// ═══════════════════════════════════════════════════════════════════════════

describe('parseCSV — parsing de extratos CSV', () => {
  test('CSV com vírgula como separador', () => {
    const csv = `01/05/2026,Salário,1500.00\n10/05/2026,Aluguel,-350.75`;
    const txns = parseCSV(csv);
    expect(txns).toHaveLength(2);
  });

  test('CSV com ponto-e-vírgula como separador', () => {
    const csv = `data;descricao;valor\n01/05/2026;Salário;1500,00\n10/05/2026;Aluguel;-350,75`;
    const txns = parseCSV(csv);
    expect(txns).toHaveLength(2);
    expect(txns[0].descricao).toBe('Salário');
  });

  test('pula linha de cabeçalho com palavra "data" ou "valor"', () => {
    const csv = `data,descricao,valor\n01/05/2026,Pagamento,100.00`;
    const txns = parseCSV(csv);
    expect(txns).toHaveLength(1);
    expect(txns[0].descricao).toBe('Pagamento');
  });

  test('valor positivo → credito (formato BR: vírgula decimal)', () => {
    // O parser substitui pontos por '' (separador de milhar BR) e vírgula por '.'
    const csv = `01/05/2026,Depósito,500,00`;
    const txns = parseCSV(csv);
    expect(txns[0].tipo).toBe('credito');
    expect(txns[0].valor).toBeCloseTo(500);
  });

  test('valor negativo → debito (com ponto-e-vírgula para compatibilidade com BR decimal)', () => {
    // Quando CSV usa ponto-e-vírgula, vírgula pode ser decimal sem ambiguidade
    const csv = `10/05/2026;Conta de luz;-200,50`;
    const txns = parseCSV(csv);
    expect(txns[0].tipo).toBe('debito');
    expect(txns[0].valor).toBeCloseTo(200.50);
  });

  test('data DD/MM/YYYY converte para YYYY-MM-DD', () => {
    const csv = `15/06/2026,Teste,100.00`;
    const txns = parseCSV(csv);
    expect(txns[0].data).toBe('2026-06-15');
  });

  test('data DD-MM-YYYY converte para YYYY-MM-DD', () => {
    const csv = `20-07-2026,Teste,100.00`;
    const txns = parseCSV(csv);
    expect(txns[0].data).toBe('2026-07-20');
  });

  test('data DD/MM/YYYY com ano completo é convertida corretamente', () => {
    // O parser usa regex DD/MM/YYYY — ISO YYYY-MM-DD como entrada não é suportado
    // (o parser interpreta incorretamente partes da string ISO)
    const csv = `10/08/2026,Teste,100,00`;
    const txns = parseCSV(csv);
    expect(txns[0].data).toBe('2026-08-10');
  });

  test('valor com vírgula decimal (1.500,75) é parseado corretamente', () => {
    const csv = `01/05/2026;Salário;1.500,75`;
    const txns = parseCSV(csv);
    expect(txns[0].valor).toBeCloseTo(1500.75);
  });

  test('linha sem valor válido é ignorada', () => {
    const csv = `01/05/2026,Sem valor`;
    const txns = parseCSV(csv);
    expect(txns).toHaveLength(0);
  });

  test('CSV sem colunas numéricas retorna array vazio', () => {
    // Linha sem valor numérico é ignorada pelo parser
    const csv = `01/05/2026;apenas descricao sem valor`;
    const txns = parseCSV(csv);
    expect(txns).toEqual([]);
  });

  test('linhas em branco são ignoradas', () => {
    const csv = `01/05/2026,Teste,100.00\n\n\n10/05/2026,Outro,50.00`;
    const txns = parseCSV(csv);
    expect(txns).toHaveLength(2);
  });

  test('valores entre aspas são extraídos corretamente', () => {
    // Parser remove aspas simples e duplas das células
    const csv = `"01/05/2026","Desc","100,00"`;
    const txns = parseCSV(csv);
    expect(txns).toHaveLength(1);
    expect(txns[0].valor).toBeCloseTo(100);
  });

  test('importar = true em todas as transações CSV', () => {
    const csv = `01/05/2026,A,100\n02/05/2026,B,200`;
    const txns = parseCSV(csv);
    txns.forEach(t => expect(t.importar).toBe(true));
  });

  // ── Regressões: bugs corrigidos na revisão da importação OFX/CSV ──────────

  test('valor com ponto decimal (1500.00) NÃO é inflado para 150000', () => {
    const csv = `01/05/2026;Pagamento;1500.00`;
    const txns = parseCSV(csv);
    expect(txns[0].valor).toBeCloseTo(1500);
  });

  test('coluna de nº de documento não é confundida com o valor', () => {
    // Data;Documento(000123);Descrição;Valor(-200,00) → deve pegar -200,00
    const csv = `01/05/2026;000123;Pagamento;-200,00`;
    const txns = parseCSV(csv);
    expect(txns[0].valor).toBeCloseTo(200);
    expect(txns[0].tipo).toBe('debito');
  });

  test('coluna de saldo não vaza para a descrição nem vira o valor', () => {
    // Data;Histórico;Valor;Saldo
    const csv = `01/05/2026;Compra mercado;-50,00;1.200,00`;
    const txns = parseCSV(csv);
    expect(txns[0].valor).toBeCloseTo(50);
    expect(txns[0].descricao).toBe('Compra mercado');
  });

  test('fitId do CSV é estável por conteúdo (mesmo CSV → mesmo fitId)', () => {
    const csv = `01/05/2026;Compra;-50,00`;
    const a = parseCSV(csv)[0].fitId;
    const b = parseCSV(csv)[0].fitId;
    expect(a).toBe(b);
    expect(a).toContain('csv|');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Testes de escapeHtmlSearch
// ═══════════════════════════════════════════════════════════════════════════

describe('escapeHtmlSearch — sanitização HTML', () => {
  test('escapa & para &amp;', () => {
    expect(escapeHtmlSearch('A & B')).toBe('A &amp; B');
  });

  test('escapa < para &lt;', () => {
    expect(escapeHtmlSearch('<script>')).toBe('&lt;script&gt;');
  });

  test('escapa > para &gt;', () => {
    expect(escapeHtmlSearch('a > b')).toBe('a &gt; b');
  });

  test('escapa " para &quot;', () => {
    expect(escapeHtmlSearch('"citação"')).toBe('&quot;citação&quot;');
  });

  test('string normal sem caracteres especiais não é alterada', () => {
    expect(escapeHtmlSearch('Conta de Serviços')).toBe('Conta de Serviços');
  });

  test('converte não-string para string antes de escapar', () => {
    expect(escapeHtmlSearch(42)).toBe('42');
    expect(escapeHtmlSearch(null)).toBe('null');
  });

  test('escapa múltiplos caracteres especiais juntos', () => {
    const input  = '<img src="x" onerror="alert(1)">';
    const output = escapeHtmlSearch(input);
    expect(output).not.toContain('<');
    expect(output).not.toContain('>');
    expect(output).not.toContain('"');
  });

  test('XSS payload clássico é sanitizado', () => {
    const xss = '<script>alert("xss")</script>';
    const out  = escapeHtmlSearch(xss);
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Testes da matriz PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Matriz PERMISSIONS — hierarquia de perfis', () => {
  // Admin pode tudo
  test('admin pode todas as ações', () => {
    Object.keys(PERMISSIONS).forEach(acao => {
      expect(can('admin', acao)).toBe(true);
    });
  });

  // Gerente
  test('gerente pode addConta', () => expect(can('gerente', 'addConta')).toBe(true));
  test('gerente NÃO pode removeConta', () => expect(can('gerente', 'removeConta')).toBe(false));
  test('gerente NÃO pode manageUsers', () => expect(can('gerente', 'manageUsers')).toBe(false));
  test('gerente pode newLancamento', () => expect(can('gerente', 'newLancamento')).toBe(true));
  test('gerente pode removeLancamento', () => expect(can('gerente', 'removeLancamento')).toBe(true));

  // Operador
  test('operador pode newLancamento', () => expect(can('operador', 'newLancamento')).toBe(true));
  test('operador pode editLancamento', () => expect(can('operador', 'editLancamento')).toBe(true));
  test('operador NÃO pode addConta', () => expect(can('operador', 'addConta')).toBe(false));
  test('operador NÃO pode removeLancamento', () => expect(can('operador', 'removeLancamento')).toBe(false));
  test('operador pode exportData', () => expect(can('operador', 'exportData')).toBe(true));
  test('operador pode viewBalance', () => expect(can('operador', 'viewBalance')).toBe(true));

  // Visualizador
  test('visualizador NÃO pode nenhuma escrita', () => {
    const escritas = ['addConta', 'renameConta', 'removeConta', 'newLancamento', 'editLancamento', 'removeLancamento'];
    escritas.forEach(acao => expect(can('visualizador', acao)).toBe(false));
  });
  test('visualizador pode exportData', () => expect(can('visualizador', 'exportData')).toBe(true));
  test('visualizador pode viewReports', () => expect(can('visualizador', 'viewReports')).toBe(true));
  test('visualizador NÃO pode viewBalance', () => expect(can('visualizador', 'viewBalance')).toBe(false));

  // Ação inexistente
  test('ação inexistente retorna false para qualquer perfil', () => {
    expect(can('admin', 'acaoInexistente')).toBe(false);
    expect(can('operador', 'deletarTudo')).toBe(false);
  });
});
