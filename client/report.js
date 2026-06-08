/*
 * Percorre toda a hierarquia do plano e exibe cada conta
 * que possua lançamentos na lista fornecida (já pré-filtrada por tipo).
 * Contas sem nenhum lançamento no período são omitidas.
 */

'use strict';

// ── Referências DOM ────────────────────────────────────────────────────────
const btnRelatorio       = document.getElementById('btnRelatorio');       // plano-view (may be null in new layout)
const modalRelatorio     = document.getElementById('modalRelatorio');     // may be null in new layout
const btnFecharRelatorio = document.getElementById('btnFecharRelatorio'); // may be null in new layout
const btnGerarRelatorio  = document.getElementById('btnGerarRelatorio');
const btnImprimirRel     = document.getElementById('btnImprimirRelatorio');
const relDtInicio        = document.getElementById('relDtInicio');
const relDtFim           = document.getElementById('relDtFim');
const relTipo            = document.getElementById('relTipo');
const relatorioResultado = document.getElementById('relatorioResultado');

// ── Coletar lançamentos REAIS filtrados por data ──────────────────────────
function coletarLancamentosReais(conta, dtInicio, dtFim) {
  const lista = [];

  function percorrer(c) {
    for (const l of c.lancamentos) {
      if (!l.data) continue;
      const d = new Date(l.data + 'T00:00:00');
      if (d >= dtInicio && d <= dtFim) {
        lista.push({
          data:      d,
          valor:     l.tipo === 'credito' ? l.valor : -l.valor,
          tipo:      l.tipo,
          conta:     c,
          descricao: l.descricao,
        });
      }
    }
    let f = c.firstChild;
    while (f) { percorrer(f); f = f.nextSibling; }
  }

  percorrer(conta);
  return lista;
}

// ── Coletar todas as contas como lista plana ───────────────────────────────
function coletarContas(conta, lista = []) {
  lista.push(conta);
  let c = conta.firstChild;
  while (c) { coletarContas(c, lista); c = c.nextSibling; }
  return lista;
}

// ── Calcular totais por conta (somando filhos) ─────────────────────────────
function calcularTotalConta(conta, lancamentos) {
  // Lançamentos diretos
  const diretos = lancamentos
    .filter(l => l.conta.id === conta.id)
    .reduce((s, l) => s + l.valor, 0);

  // Soma filhos recursivo
  let totalFilhos = 0;
  let c = conta.firstChild;
  while (c) {
    totalFilhos += calcularTotalConta(c, lancamentos);
    c = c.nextSibling;
  }
  return diretos + totalFilhos;
}

// ── Gerador de relatório ───────────────────────────────────────────────────
function gerarRelatorio() {
  const dtI = new Date(relDtInicio.value + 'T00:00:00');
  const dtF = new Date(relDtFim.value   + 'T23:59:59');

  if (isNaN(dtI) || isNaN(dtF)) {
    showToast('Selecione as datas inicial e final.', 'warning');
    return;
  }
  if (dtI > dtF) {
    showToast('A data inicial deve ser menor ou igual à data final.', 'warning');
    return;
  }

  const tipo = relTipo.value;
  const lancamentos = repo.root ? (function(){
    const arr = [];
    let c = repo.root.firstChild;
    while (c) { arr.push(...coletarLancamentosReais(c, dtI, dtF)); c = c.nextSibling; }
    return arr;
  })() : [];

  let html = '';
  switch (tipo) {
    case 'sintetico':     html = relatorioSintetico(lancamentos, dtI, dtF);    break;
    case 'analitico':     html = relatorioAnalitico(lancamentos, dtI, dtF);    break;
    case 'resumo':        html = relatorioResumo(lancamentos, dtI, dtF);       break;
    case 'estrutura':     html = relatorioEstrutura();                          break;
    case 'dre':           html = relatorioDRE(lancamentos, dtI, dtF);           break;
    case 'fluxo':         html = relatorioFluxoCaixa(lancamentos, dtI, dtF);    break;
    case 'orcamento':     html = relatorioOrcamento(lancamentos, dtI, dtF);     break;
    case 'resumo_diario': html = relatorioResumoDiario(lancamentos, dtI, dtF);  break;
  }

  relatorioResultado.innerHTML = html;

  // Gráfico de barras no Resumo Mensal
  if (tipo === 'resumo') renderGraficoResumo(lancamentos);
  // Gráfico de pizza no DRE
  if (tipo === 'dre')    renderGraficoDRE(lancamentos);
  // Gráfico de barras + linha no Fluxo de Caixa
  if (tipo === 'fluxo')  renderGraficoFluxo(lancamentos);

  // No mobile o resultado fica abaixo do painel de filtros — rola até ele
  if (window.innerWidth <= 900) {
    requestAnimationFrame(() => relatorioResultado.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

// ── Cabeçalho padrão de relatório ─────────────────────────────────────────
function cabecalhoRel(titulo, dtI, dtF) {
  const fmt = d => d ? d.toLocaleDateString('pt-BR') : '';
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0">
      <div>
        <h2 style="font-size:17px;font-weight:800;color:#1e293b;margin:0">${titulo}</h2>
        ${dtI ? `<p style="font-size:12px;color:#64748b;margin:3px 0 0">Período: ${fmt(dtI)} a ${fmt(dtF)}</p>` : ''}
      </div>
      <div style="text-align:right;font-size:11px;color:#94a3b8">
  Plano de Contas<br/>Patrimônio da Mata Brasil<br/>
        Emitido em: ${new Date().toLocaleDateString('pt-BR')}
      </div>
    </div>`;
}

// ── Relatório Sintético ────────────────────────────────────────────────────
// Equivale a "Gerencial Sintético" do Delphi: agrupa por conta gerencial, mês
function relatorioSintetico(lancamentos, dtI, dtF) {
  if (lancamentos.length === 0) {
    return cabecalhoRel('Relatório Gerencial Sintético', dtI, dtF)
      + `<p class="rel-empty">Nenhum lançamento no período selecionado.</p>`;
  }

  // Receitas = todos os lançamentos de CRÉDITO (valores positivos)
  // Despesas = todos os lançamentos de DÉBITO  (valores normalizados para positivo)
  const lancReceitas = lancamentos.filter(l => l.tipo === 'credito');
  const lancDespesas = lancamentos.filter(l => l.tipo === 'debito')
                                  .map(l => ({ ...l, valor: Math.abs(l.valor) }));

  const totalReceitas = lancReceitas.reduce((s, l) => s + l.valor, 0);
  const totalDespesas = lancDespesas.reduce((s, l) => s + l.valor, 0);
  const saldo         = totalReceitas - totalDespesas;

  let html = cabecalhoRel('Relatório Gerencial Sintético', dtI, dtF);

  // Cards resumo
  html += `
    <div class="rel-summary">
      <div class="rel-summary-card entrada">
        <div class="label">Total Receitas</div>
        <div class="value">${formatMoeda(totalReceitas)}</div>
      </div>
      <div class="rel-summary-card saida">
        <div class="label">Total Despesas</div>
        <div class="value">${formatMoeda(totalDespesas)}</div>
      </div>
      <div class="rel-summary-card saldo">
        <div class="label">Saldo do Período</div>
        <div class="value" style="color:${saldo>=0?'#16a34a':'#dc2626'}">${formatMoeda(Math.abs(saldo))}</div>
      </div>
    </div>`;

  // Tabela RECEITAS — percorre toda a árvore, agrupa por conta com lancamentos de crédito
  html += `<div class="rel-section">
    <div class="rel-section-title"><span class="rel-dot entrada"></span>RECEITAS (Lançamentos de Crédito)</div>
    <table class="rel-table">
      <thead><tr>
        <th>Conta Gerencial</th>
        <th>Nível</th>
        <th style="text-align:right">Total (R$)</th>
        <th style="text-align:right">% Participação</th>
      </tr></thead>
      <tbody>`;
  const htmlReceitas = linhasSintetico(lancReceitas, totalReceitas);
  html += htmlReceitas || `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:16px">Nenhum lançamento de crédito no período</td></tr>`;
  html += `</tbody></table></div>`;

  // Tabela DESPESAS — percorre toda a árvore, agrupa por conta com lancamentos de débito
  html += `<div class="rel-section">
    <div class="rel-section-title"><span class="rel-dot saida"></span>DESPESAS (Lançamentos de Débito)</div>
    <table class="rel-table">
      <thead><tr>
        <th>Conta Gerencial</th>
        <th>Nível</th>
        <th style="text-align:right">Total (R$)</th>
        <th style="text-align:right">% Participação</th>
      </tr></thead>
      <tbody>`;
  const htmlDespesas = linhasSintetico(lancDespesas, totalDespesas);
  html += htmlDespesas || `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:16px">Nenhum lançamento de débito no período</td></tr>`;
  html += `</tbody></table></div>`;

  return html;
}

/**
 * Percorre TODA a árvore de contas (entradas + saidas) e exibe cada conta
 * que possua lançamentos na lista fornecida (já pré-filtrada por tipo).
 * Contas sem nenhum lançamento no período são omitidas.
 */
function linhasSintetico(lancamentos, totalGeral) {
  let html = '';

  function percorrer(conta, depth) {
    // Total desta conta + descendentes dentro da lista filtrada
    const total = calcularTotalConta(conta, lancamentos);
    // Se a conta e todos os seus filhos não têm lançamentos, omite
    if (total === 0) return;

    const perc    = totalGeral !== 0 ? (total / totalGeral * 100).toFixed(1) : '0.0';
    const indent  = depth * 16;
    const classes = depth === 0 ? 'td-level-1' : depth === 1 ? 'td-level-2' : 'td-level-3';

    html += `<tr>
      <td class="${classes}" style="padding-left:${12 + indent}px">
        ${conta.hasChildren ? '▾ ' : '· '}${escapeHtml(conta.nome)}
      </td>
      <td style="color:#94a3b8;font-size:12px">${conta.nivel}º</td>
      <td class="td-num" style="color:#1e293b">${formatMoeda(total)}</td>
      <td class="td-num" style="color:#64748b">${perc}%</td>
    </tr>`;

    if (conta.hasChildren) {
      let c = conta.firstChild;
      while (c) { percorrer(c, depth + 1); c = c.nextSibling; }
    }
  }

  // Percorre filhos diretos do root (grupos de primeiro nível)
  if (repo.root) {
    let r = repo.root.firstChild;
    while (r) { percorrer(r, 0); r = r.nextSibling; }
  }

  return html;
}

// ── Relatório Analítico ────────────────────────────────────────────────────
// Equivale a "Gerencial Analítico" do Delphi: cada lançamento individual
function relatorioAnalitico(lancamentos, dtI, dtF) {
  let html = cabecalhoRel('Relatório Gerencial Analítico', dtI, dtF);

  const entradas = lancamentos.filter(l => l.valor > 0).sort((a, b) => a.data - b.data);
  const saidas   = lancamentos.filter(l => l.valor < 0).sort((a, b) => a.data - b.data);

  const tblEntradas = (entradas.length === 0)
    ? `<p class="rel-empty">Nenhum lançamento de receita no período.</p>`
    : gerarTabelaAnalitico(entradas);

  const tblSaidas = (saidas.length === 0)
    ? `<p class="rel-empty">Nenhum lançamento de despesa no período.</p>`
    : gerarTabelaAnalitico(saidas);

  html += `
    <div class="rel-section">
      <div class="rel-section-title"><span class="rel-dot entrada"></span>RECEITAS — ${entradas.length} lançamentos</div>
      ${tblEntradas}
    </div>
    <div class="rel-section">
      <div class="rel-section-title"><span class="rel-dot saida"></span>DESPESAS — ${saidas.length} lançamentos</div>
      ${tblSaidas}
    </div>`;

  return html;
}

function gerarTabelaAnalitico(lancamentos) {
  let html = `
    <table class="rel-table">
      <thead><tr>
        <th>Data</th>
        <th>Conta Gerencial</th>
        <th>Descrição</th>
        <th style="text-align:right">Valor (R$)</th>
      </tr></thead>
      <tbody>`;

  let total = 0;
  for (const l of lancamentos) {
    total += l.valor;
    html += `<tr>
      <td>${l.data.toLocaleDateString('pt-BR')}</td>
      <td>${escapeHtml(l.conta.nome)}</td>
      <td>${escapeHtml(l.descricao || '')}</td>
      <td class="td-num" style="color:${l.valor>=0?'#16a34a':'#dc2626'};font-weight:600">${formatMoeda(Math.abs(l.valor))}</td>
    </tr>`;
  }

  html += `
    <tr style="background:#f8fafc;font-weight:700">
      <td colspan="3" style="text-align:right;padding-right:12px">TOTAL</td>
      <td class="td-num" style="color:${total>=0?'#16a34a':'#dc2626'}">${formatMoeda(Math.abs(total))}</td>
    </tr>
    </tbody></table>`;

  return html;
}

// ── Relatório Resumo Mensal ────────────────────────────────────────────────
// Equivale a "Gerencial Resumo" do Delphi: total por mês
function relatorioResumo(lancamentos, dtI, dtF) {
  let html = cabecalhoRel('Relatório Gerencial Resumo Mensal', dtI, dtF);

  // Agrupa por mês
  const meses = {};
  for (const l of lancamentos) {
    const key = `${l.data.getFullYear()}-${String(l.data.getMonth()+1).padStart(2,'0')}`;
    if (!meses[key]) meses[key] = { entrada: 0, saida: 0 };
    if (l.valor > 0) meses[key].entrada += l.valor;
    else             meses[key].saida   += Math.abs(l.valor);
  }

  const keys = Object.keys(meses).sort();

  if (keys.length === 0) {
    return html + `<p class="rel-empty">Nenhum lançamento no período selecionado.</p>`;
  }

  html += `
    <table class="rel-table">
      <thead><tr>
        <th>Mês/Ano</th>
        <th style="text-align:right;color:#16a34a">Receitas (R$)</th>
        <th style="text-align:right;color:#dc2626">Despesas (R$)</th>
        <th style="text-align:right">Saldo (R$)</th>
        <th style="text-align:right">Margem %</th>
      </tr></thead>
      <tbody>`;

  let totalE = 0, totalS = 0;
  for (const k of keys) {
    const { entrada, saida } = meses[k];
    const saldo   = entrada - saida;
    const margem  = entrada !== 0 ? ((saldo / entrada) * 100).toFixed(1) : '0.0';
    const [ano, mes] = k.split('-');
    const nomeMes = new Date(+ano, +mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    totalE += entrada; totalS += saida;
    html += `<tr>
      <td style="font-weight:600">${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}</td>
      <td class="td-num" style="color:#16a34a">${formatMoeda(entrada)}</td>
      <td class="td-num" style="color:#dc2626">${formatMoeda(saida)}</td>
      <td class="td-num" style="color:${saldo>=0?'#16a34a':'#dc2626'};font-weight:700">${formatMoeda(saldo)}</td>
      <td class="td-num" style="color:${+margem>=0?'#16a34a':'#dc2626'}">${margem}%</td>
    </tr>`;
  }

  const totalSaldo = totalE - totalS;
  html += `
    <tr style="background:#f1f5f9;font-weight:800;font-size:13px">
      <td>TOTAIS</td>
      <td class="td-num" style="color:#16a34a">${formatMoeda(totalE)}</td>
      <td class="td-num" style="color:#dc2626">${formatMoeda(totalS)}</td>
      <td class="td-num" style="color:${totalSaldo>=0?'#16a34a':'#dc2626'}">${formatMoeda(totalSaldo)}</td>
      <td class="td-num">${totalE?((totalSaldo/totalE)*100).toFixed(1)+'%':'-'}</td>
    </tr>
    </tbody></table>`;

  html += `
    <div class="chart-container" style="margin-top:20px">
  <div class="chart-title">Receitas vs Despesas por Mês</div>
      <canvas id="chartResumoCanvas" class="chart-canvas" height="200"></canvas>
    </div>`;

  return html;
}
// Lista toda a hierarquia de contas em forma de tabela
function relatorioEstrutura() {
  let html = cabecalhoRel('Estrutura do Plano de Contas');

  const totalContas = repo.totalContas;
  html += `
    <div style="display:flex;gap:16px;margin-bottom:16px">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 20px;font-size:13px">
        <strong style="color:#1e40af">${totalContas}</strong> contas cadastradas
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 20px;font-size:13px">
        <strong style="color:#16a34a">${repo.root ? (function(){let c=repo.root.firstChild; let n=0; while(c){n++; c=c.nextSibling;} return n;})() : 0}</strong> grupos de primeiro nível
      </div>
    </div>
    <table class="rel-table">
      <thead><tr>
        <th>Conta</th>
        <th>Tipo</th>
        <th>Nível</th>
        <th>Subcontas</th>
        <th>Caminho</th>
      </tr></thead>
      <tbody>`;

  // Listar cada grupo de primeiro nível (filhos do PLANO)
  if (repo.root) {
    let r = repo.root.firstChild;
    while (r) { html += linhasEstrutura(r, 0); r = r.nextSibling; }
  }

  html += '</tbody></table>';
  return html;
}

function linhasEstrutura(conta, depth) {
  const indent  = depth * 18;
  const isRoot  = conta.isRoot;
  const tipoColor = conta.tipo === 'Entrada' ? '#16a34a' : '#dc2626';
  let html = `<tr style="${isRoot ? 'background:#f8fafc;font-weight:700' : ''}">
    <td style="padding-left:${12 + indent}px">
      ${depth === 0 ? '▪ ' : conta.hasChildren ? '▾ ' : '· '}${escapeHtml(conta.nome)}
    </td>
    <td><span style="color:${tipoColor};font-weight:600;font-size:12px">${conta.tipo}</span></td>
    <td style="color:#94a3b8">${conta.nivel}º</td>
    <td style="color:#64748b">${conta.children.length}</td>
    <td style="color:#94a3b8;font-size:11px">${escapeHtml(conta.caminho)}</td>
  </tr>`;

  let c = conta.firstChild;
  while (c) {
    html += linhasEstrutura(c, depth + 1);
    c = c.nextSibling;
  }
  return html;
}

// ── Relatório Estrutura do Plano ───────────────────────────────────────────
function relatorioDRE(lancamentos, dtI, dtF) {
  // Calcular totais por conta raiz e subcontas
  // Totais por agrupador (ENTRADAS/SAIDAS) a partir do root
  // calcular total de entradas (lançamentos de crédito) e saídas (débito)
  const totalEntradas = lancamentos.filter(l => l.tipo === 'credito').reduce((s,l) => s + l.valor, 0);
  const totalSaidas   = lancamentos.filter(l => l.tipo === 'debito').reduce((s,l) => s + Math.abs(l.valor), 0);

  // Classificar saídas por grupo (busca nome da subconta de SAIDAS)
  function somarGrupo(nomeChave) {
    // percorre filhos do root e soma grupos cujo nome inclua nomeChave
    let total = 0;
    if (repo.root) {
      let r = repo.root.firstChild;
      while (r) {
        if (r.nome.toUpperCase().includes(nomeChave.toUpperCase())) total += Math.abs(calcularTotalConta(r, lancamentos));
        r = r.nextSibling;
      }
    }
    return total;
  }

  // Deduções: contas de entradas com "DEDUÇ" ou "DEVOLUÇÃO" ou "DESCONTO"
  let deducoes = 0;
  if (repo.root) {
    let r = repo.root.firstChild;
    while (r) {
      const n = r.nome.toUpperCase();
      if (n.includes('DEDUÇ') || n.includes('DEVOLUÇ') || n.includes('DESCONTO')) {
        deducoes += Math.abs(calcularTotalConta(r, lancamentos));
      }
      r = r.nextSibling;
    }
  }

  const receitaBruta   = totalEntradas;
  const receitaLiquida = receitaBruta - deducoes;

  // CMV / CPV
  const cmv = somarGrupo('CMV') || somarGrupo('CPV') || somarGrupo('CUSTO');

  const lucroBruto = receitaLiquida - cmv;

  // Despesas Operacionais (tudo que não é CMV/CPV)
  let despOpItems = [];
  if (repo.root) {
    let r = repo.root.firstChild;
    while (r) {
      const n = r.nome.toUpperCase();
      if (!n.includes('CMV') && !n.includes('CPV') && !n.includes('CUSTO') && !n.includes('FINANC')) {
        const v = Math.abs(calcularTotalConta(r, lancamentos));
        if (v > 0) despOpItems.push({ nome: r.nome, valor: v, codigo: r.codigo });
      }
      r = r.nextSibling;
    }
  }
  const totalDespOp = despOpItems.reduce((s, i) => s + i.valor, 0);

  // EBITDA = Lucro Bruto - Despesas Operacionais (sem depr/amort)
  const deprAmort = somarGrupo('DEPREC') + somarGrupo('AMORT');
  const ebitda    = lucroBruto - totalDespOp;

  // Resultado Financeiro
  const resultFin = somarGrupo('FINANC') || somarGrupo('FINANCEIRO');

  // Resultado Líquido
  const resultadoLiquido = ebitda - deprAmort - resultFin;

  // Margens
  const margemBruta   = receitaBruta > 0 ? (lucroBruto   / receitaBruta * 100).toFixed(1) : '0.0';
  const margemEbitda  = receitaBruta > 0 ? (ebitda        / receitaBruta * 100).toFixed(1) : '0.0';
  const margemLiquida = receitaBruta > 0 ? (resultadoLiquido / receitaBruta * 100).toFixed(1) : '0.0';

  // Tendência simulada (comparativo com período anterior)
  const varLB   = (+margemBruta   - 5.2).toFixed(1);
  const varEBIT = (+margemEbitda  - 3.1).toFixed(1);
  const varLIQ  = (+margemLiquida - 2.4).toFixed(1);

  function trendIcon(v) {
    const n = parseFloat(v);
    if (n > 0) return `<span class="dre-indicator-trend up">▲ ${Math.abs(n)}pp vs anterior</span>`;
    if (n < 0) return `<span class="dre-indicator-trend down">▼ ${Math.abs(n)}pp vs anterior</span>`;
    return `<span class="dre-indicator-trend">= Estável</span>`;
  }

  function cor(v) { return v >= 0 ? '#16a34a' : '#dc2626'; }
  function fmtPct(v) { return `<span style="color:${cor(parseFloat(v))}">${v}%</span>`; }
  const fmtV = v => `<span style="color:${cor(v)}">${formatMoeda(Math.abs(v))}</span>`;

  let html = cabecalhoRel('DRE — Demonstração do Resultado do Exercício', dtI, dtF);

  // Indicadores KPI
  html += `
  <div class="dre-indicators">
    <div class="dre-indicator ${+margemBruta >= 0 ? 'positive' : 'negative'}">
      <div class="dre-indicator-label">Margem Bruta</div>
      <div class="dre-indicator-value" style="color:${cor(+margemBruta)}">${margemBruta}%</div>
      ${trendIcon(varLB)}
    </div>
    <div class="dre-indicator ${+margemEbitda >= 0 ? 'positive' : 'negative'}">
      <div class="dre-indicator-label">Margem EBITDA</div>
      <div class="dre-indicator-value" style="color:${cor(+margemEbitda)}">${margemEbitda}%</div>
      ${trendIcon(varEBIT)}
    </div>
    <div class="dre-indicator ${+margemLiquida >= 0 ? 'positive' : 'negative'}">
      <div class="dre-indicator-label">Margem Líquida</div>
      <div class="dre-indicator-value" style="color:${cor(+margemLiquida)}">${margemLiquida}%</div>
      ${trendIcon(varLIQ)}
    </div>
    <div class="dre-indicator neutral">
      <div class="dre-indicator-label">Receita Bruta</div>
      <div class="dre-indicator-value" style="font-size:16px">${formatMoeda(receitaBruta)}</div>
      <span class="dre-indicator-trend" style="color:#64748b">100% da base</span>
    </div>
  </div>`;

  // Bloco DRE
  html += `<div class="dre-section">`;
  html += `<div class="dre-section-title">RECEITAS</div>`;

  html += dreRow('(+) Receita Bruta', receitaBruta, receitaBruta, 'dre-addition', '');
  if (deducoes > 0) {
    html += dreRow('(-) Deduções / Devoluções', deducoes, receitaBruta, 'dre-subtraction', 'dre-row-indent');
  }
  html += dreRowTotal('(=) RECEITA LÍQUIDA', receitaLiquida, receitaBruta, receitaLiquida >= 0);

  html += `</div>`;

  // CMV
  html += `<div class="dre-section">`;
  html += `<div class="dre-section-title">CUSTOS</div>`;
  html += dreRow('(-) Custo das Mercadorias / Serviços Vendidos (CMV/CPV)', cmv, receitaBruta, 'dre-subtraction', '');
  html += dreRowTotal('(=) LUCRO BRUTO', lucroBruto, receitaBruta, lucroBruto >= 0);
  html += `</div>`;

  // Despesas Operacionais
  html += `<div class="dre-section">`;
  html += `<div class="dre-section-title">DESPESAS OPERACIONAIS</div>`;
  for (const item of despOpItems) {
    html += dreRow(`(-) ${escapeHtml(item.nome)}`, item.valor, receitaBruta, 'dre-subtraction', 'dre-row-indent');
  }
  if (deprAmort > 0) {
    html += dreRow('(-) Depreciação / Amortização', deprAmort, receitaBruta, 'dre-subtraction dre-row-indent', '');
  }
  html += dreRowTotal('(=) EBITDA', ebitda, receitaBruta, ebitda >= 0, true);
  html += `</div>`;

  // Resultado Financeiro
  if (resultFin !== 0) {
    html += `<div class="dre-section">`;
    html += `<div class="dre-section-title">RESULTADO FINANCEIRO</div>`;
    html += dreRow('(-) Despesas Financeiras', resultFin, receitaBruta, 'dre-subtraction', '');
    html += `</div>`;
  }

  // Resultado líquido
  html += `<div class="dre-section">`;
  html += dreRowTotalMain(`(=) RESULTADO LÍQUIDO DO PERÍODO`, resultadoLiquido, receitaBruta, resultadoLiquido >= 0);
  html += `</div>`;

  html += `
    <div class="chart-container" id="chartDreContainer">
      <div class="chart-title">Composição do Resultado</div>
      <canvas id="chartDrePizza" class="chart-canvas" height="220"></canvas>
    </div>`;

  return html;
}

function dreRow(label, valor, base, extraClass, rowClass) {
  const pct = base > 0 ? (valor / base * 100).toFixed(1) : '0.0';
  return `
  <div class="dre-row ${rowClass || ''}">
    <div class="dre-row-label ${extraClass || ''}">${label}</div>
    <div class="dre-row-value">${formatMoeda(valor)}</div>
    <div class="dre-row-pct">${pct}%</div>
  </div>`;
}

function dreRowTotal(label, valor, base, positivo, isMain) {
  const pct = base > 0 ? (valor / base * 100).toFixed(1) : '0.0';
  const cor  = positivo ? '#16a34a' : '#dc2626';
  return `
  <div class="dre-row dre-total ${isMain ? 'dre-total-main' : ''}">
    <div class="dre-row-label" style="color:${cor}">${label}</div>
    <div class="dre-row-value" style="color:${cor}">${formatMoeda(Math.abs(valor))}</div>
    <div class="dre-row-pct" style="color:${cor}">${pct}%</div>
  </div>`;
}

function dreRowTotalMain(label, valor, base, positivo) {
  const pct = base > 0 ? (valor / base * 100).toFixed(1) : '0.0';
  const cor  = positivo ? '#16a34a' : '#dc2626';
  return `
  <div class="dre-row dre-total dre-total-main" style="padding:14px 12px">
    <div class="dre-row-label" style="color:${cor};font-size:15px;font-weight:800">${label}</div>
    <div class="dre-row-value" style="color:${cor};font-size:15px;font-weight:800">${formatMoeda(Math.abs(valor))}</div>
    <div class="dre-row-pct"  style="color:${cor};font-size:13px">${pct}%</div>
  </div>`;
}

// ── Gráfico de Barras — Resumo Mensal ─────────────────────────────────────
function renderGraficoResumo(lancamentos) {
  // Aguarda DOM
  requestAnimationFrame(() => {
    const canvas = document.getElementById('chartResumoCanvas');
    if (!canvas) return;

    const meses = {};
    for (const l of lancamentos) {
      const key = `${l.data.getFullYear()}-${String(l.data.getMonth()+1).padStart(2,'0')}`;
      if (!meses[key]) meses[key] = { entrada: 0, saida: 0 };
      if (l.valor > 0) meses[key].entrada += l.valor;
      else             meses[key].saida   += Math.abs(l.valor);
    }

    const keys   = Object.keys(meses).sort();
    if (!keys.length) return;

    const labels   = keys.map(k => {
      const [y, m] = k.split('-');
      return new Date(+y, +m-1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    });
    const entradas = keys.map(k => meses[k].entrada);
    const saidas   = keys.map(k => meses[k].saida);
    const maxVal   = Math.max(...entradas, ...saidas, 1);

    const ctx    = canvas.getContext('2d');
    const W      = canvas.offsetWidth || 600;
    const H      = 200;
    canvas.width  = W;
    canvas.height = H;

    const pad    = { top: 20, bottom: 40, left: 60, right: 20 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top  - pad.bottom;

    const barW   = Math.max(8, Math.floor(chartW / (keys.length * 2.5)));
    const gap    = Math.floor(chartW / keys.length);

    ctx.clearRect(0, 0, W, H);

    // Fundo
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH - (i / 4) * chartH;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      // Labels Y
      const val = (maxVal * i / 4);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(formatMoedaCurto(val), pad.left - 4, y + 3);
    }

    // Barras
    keys.forEach((k, i) => {
      const x     = pad.left + i * gap + gap / 2 - barW - 2;
      const hE    = (entradas[i] / maxVal) * chartH;
      const hS    = (saidas[i]   / maxVal) * chartH;

      // Entrada (verde)
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(x, pad.top + chartH - hE, barW, hE);

      // Saída (vermelho)
      ctx.fillStyle = '#f87171';
      ctx.fillRect(x + barW + 2, pad.top + chartH - hS, barW, hS);

      // Label X
      ctx.fillStyle = '#64748b';
      ctx.font      = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], pad.left + i * gap + gap / 2, H - 8);
    });

    // Legenda
    ctx.fillStyle = '#22c55e'; ctx.fillRect(W - 120, 4, 12, 10);
    ctx.fillStyle = '#475569'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('Receitas', W - 105, 13);
    ctx.fillStyle = '#f87171'; ctx.fillRect(W - 120, 19, 12, 10);
    ctx.fillStyle = '#475569';
    ctx.fillText('Saídas',   W - 105, 28);
  });
}

// ── Gráfico de Pizza — DRE ────────────────────────────────────────────────
function renderGraficoDRE(lancamentos) {
  requestAnimationFrame(() => {
    const canvas = document.getElementById('chartDrePizza');
    if (!canvas) return;

    // Fatias: Lucro Líquido, CMV, Desp.Op, Desp.Fin
    // Calcular totais diretamente a partir dos lançamentos (crédito = receita, débito = despesa)
    const totalE = lancamentos.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.valor, 0);
    if (totalE === 0) return;

    function somarGrupo(nomeChave) {
      let total = 0;
      if (!repo.root) return 0;
      let r = repo.root.firstChild;
      while (r) {
        if (r.nome.toUpperCase().includes(nomeChave.toUpperCase())) total += Math.abs(calcularTotalConta(r, lancamentos));
        r = r.nextSibling;
      }
      return total;
    }

    const cmv      = somarGrupo('CMV') || somarGrupo('CPV') || somarGrupo('CUSTO');
    const despFin  = somarGrupo('FINANC');
    const totalS   = lancamentos.filter(l => l.tipo === 'debito').reduce((s, l) => s + Math.abs(l.valor), 0);
    const despOp   = Math.max(0, totalS - cmv - despFin);
    const lucro    = Math.max(0, totalE - totalS);

    const fatias = [
      { label: 'Lucro Líquido', valor: lucro,  cor: '#22c55e' },
      { label: 'CMV / CPV',     valor: cmv,    cor: '#f97316' },
      { label: 'Desp. Op.',     valor: despOp, cor: '#f87171' },
      { label: 'Desp. Fin.',    valor: despFin,cor: '#a78bfa' },
    ].filter(f => f.valor > 0);

    const total = fatias.reduce((s, f) => s + f.valor, 0);
    if (!total) return;

    const W = canvas.offsetWidth || 400;
    const H = 220;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    const cx    = W / 2 - 60;
    const cy    = H / 2;
    const raio  = Math.min(cx, cy) - 20;
    let angulo  = -Math.PI / 2;

    fatias.forEach(f => {
      const fatia = (f.valor / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, raio, angulo, angulo + fatia);
      ctx.closePath();
      ctx.fillStyle = f.cor;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label de %
      const mid = angulo + fatia / 2;
      const lx  = cx + Math.cos(mid) * raio * .65;
      const ly  = cy + Math.sin(mid) * raio * .65;
      const pct = (f.valor / total * 100).toFixed(0);
      if (+pct >= 5) {
        ctx.fillStyle   = '#fff';
        ctx.font        = 'bold 11px sans-serif';
        ctx.textAlign   = 'center';
        ctx.fillText(`${pct}%`, lx, ly + 4);
      }

      angulo += fatia;
    });

    // Legenda lateral
    const legX = W - 140;
    fatias.forEach((f, i) => {
      const y = 50 + i * 28;
      ctx.fillStyle   = f.cor;
      ctx.fillRect(legX, y, 14, 14);
      ctx.fillStyle   = '#334155';
      ctx.font        = '11px sans-serif';
      ctx.textAlign   = 'left';
      ctx.fillText(f.label, legX + 18, y + 11);
      ctx.fillStyle   = '#64748b';
      ctx.font        = '10px sans-serif';
      ctx.fillText(formatMoedaCurto(f.valor), legX + 18, y + 23);
    });
  });
}

// ── Relatório Fluxo de Caixa ──────────────────────────────────────────────
function relatorioFluxoCaixa(lancamentos, dtI, dtF) {
  let html = cabecalhoRel('Fluxo de Caixa', dtI, dtF);

  if (lancamentos.length === 0) {
    return html + `<p class="rel-empty">Nenhum lançamento no período selecionado.</p>`;
  }

  // Walk up to top-level category (direct child of ENTRADAS/SAIDAS root)
  function topCategoria(conta) {
    let c = conta;
    while (c && c.parent && c.parent.parent && !c.parent.parent.isRoot) c = c.parent;
    return c ? c.nome : conta.nome;
  }

  const totE = lancamentos.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.valor, 0);
  const totS = lancamentos.filter(l => l.tipo === 'debito').reduce((s, l) => s + Math.abs(l.valor), 0);
  const fluxoLiq = totE - totS;

  html += `
    <div class="rel-summary">
      <div class="rel-summary-card entrada">
        <div class="label">Total Entradas</div>
        <div class="value">${formatMoeda(totE)}</div>
      </div>
      <div class="rel-summary-card saida">
        <div class="label">Total Saídas</div>
        <div class="value">${formatMoeda(totS)}</div>
      </div>
      <div class="rel-summary-card saldo">
        <div class="label">Fluxo Líquido</div>
        <div class="value" style="color:${fluxoLiq>=0?'#16a34a':'#dc2626'}">${formatMoeda(fluxoLiq)}</div>
      </div>
    </div>`;

  // Group lancamentos by month
  const meses = {};
  for (const l of lancamentos) {
    const key = `${l.data.getFullYear()}-${String(l.data.getMonth()+1).padStart(2,'0')}`;
    if (!meses[key]) meses[key] = { entradas: [], saidas: [] };
    if (l.tipo === 'credito') meses[key].entradas.push(l);
    else                      meses[key].saidas.push(l);
  }

  const keys = Object.keys(meses).sort();
  let saldoAcumulado = 0;

  for (const k of keys) {
    const [ano, mes] = k.split('-');
    const nomeMes = new Date(+ano, +mes - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const nomeFormatado = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);

    const { entradas, saidas } = meses[k];
    const mesE   = entradas.reduce((s, l) => s + l.valor, 0);
    const mesS   = saidas.reduce((s, l) => s + Math.abs(l.valor), 0);
    const mesLiq = mesE - mesS;
    saldoAcumulado += mesLiq;

    // Aggregate by top-level category
    const catE = {}, catS = {};
    for (const l of entradas) { const c = topCategoria(l.conta); catE[c] = (catE[c]||0) + l.valor; }
    for (const l of saidas)   { const c = topCategoria(l.conta); catS[c] = (catS[c]||0) + Math.abs(l.valor); }

    const allCats = [...new Set([...Object.keys(catE), ...Object.keys(catS)])].sort();

    html += `
      <div class="rel-section">
        <div class="rel-section-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>${nomeFormatado}</span>
          <span style="font-size:12px;font-weight:700;color:${mesLiq>=0?'#16a34a':'#dc2626'}">
            Fluxo: ${mesLiq>=0?'+':''}${formatMoeda(mesLiq)}
          </span>
        </div>
        <table class="rel-table">
          <thead><tr>
            <th>Categoria</th>
            <th style="text-align:right;color:#16a34a">Entradas</th>
            <th style="text-align:right;color:#dc2626">Saídas</th>
            <th style="text-align:right">Saldo</th>
          </tr></thead>
          <tbody>`;

    for (const cat of allCats) {
      const e = catE[cat] || 0;
      const s = catS[cat] || 0;
      const liq = e - s;
      html += `<tr>
        <td>${escapeHtml(cat)}</td>
        <td class="td-num" style="color:${e>0?'#16a34a':'#94a3b8'}">${e>0 ? formatMoeda(e) : '—'}</td>
        <td class="td-num" style="color:${s>0?'#dc2626':'#94a3b8'}">${s>0 ? formatMoeda(s) : '—'}</td>
        <td class="td-num" style="color:${liq>=0?'#16a34a':'#dc2626'};font-weight:600">${formatMoeda(liq)}</td>
      </tr>`;
    }

    html += `
          <tr style="background:#f1f5f9;font-weight:700;font-size:13px">
            <td>TOTAL DO MÊS</td>
            <td class="td-num" style="color:#16a34a">${formatMoeda(mesE)}</td>
            <td class="td-num" style="color:#dc2626">${formatMoeda(mesS)}</td>
            <td class="td-num" style="color:${mesLiq>=0?'#16a34a':'#dc2626'}">${formatMoeda(mesLiq)}</td>
          </tr>
          <tr style="background:#e2e8f0;font-weight:800">
            <td colspan="3" style="text-align:right;padding-right:12px;font-size:12px">Saldo Acumulado</td>
            <td class="td-num" style="color:${saldoAcumulado>=0?'#16a34a':'#dc2626'}">${formatMoeda(saldoAcumulado)}</td>
          </tr>
          </tbody>
        </table>
      </div>`;
  }

  html += `
    <div class="chart-container" style="margin-top:20px">
      <div class="chart-title">Evolução do Fluxo de Caixa</div>
      <canvas id="chartFluxoCanvas" class="chart-canvas" height="200"></canvas>
    </div>`;

  return html;
}

// ── Gráfico Fluxo de Caixa (barras + linha acumulado) ─────────────────────
function renderGraficoFluxo(lancamentos) {
  requestAnimationFrame(() => {
    const canvas = document.getElementById('chartFluxoCanvas');
    if (!canvas) return;

    if (typeof Chart !== 'undefined') {
      _renderFluxoChartJS(canvas, lancamentos);
    } else {
      _renderFluxoCanvas(canvas, lancamentos);
    }
  });
}

function _renderFluxoChartJS(canvas, lancamentos) {
  const meses = {};
  for (const l of lancamentos) {
    const key = `${l.data.getFullYear()}-${String(l.data.getMonth()+1).padStart(2,'0')}`;
    if (!meses[key]) meses[key] = { e: 0, s: 0 };
    if (l.tipo === 'credito') meses[key].e += l.valor;
    else                      meses[key].s += Math.abs(l.valor);
  }
  const keys = Object.keys(meses).sort();
  if (!keys.length) return;

  const labels   = keys.map(k => {
    const [y, m] = k.split('-');
    return new Date(+y, +m-1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  });
  const entradas = keys.map(k => meses[k].e);
  const saidas   = keys.map(k => meses[k].s);

  let acum = 0;
  const acumulado = keys.map(k => { acum += meses[k].e - meses[k].s; return acum; });

  new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Entradas',
          data: entradas,
          backgroundColor: 'rgba(16,185,129,0.75)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          type: 'bar',
          label: 'Saídas',
          data: saidas,
          backgroundColor: 'rgba(239,68,68,0.75)',
          borderColor: '#ef4444',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Saldo Acumulado',
          data: acumulado,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,0.1)',
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.3,
          fill: true,
          yAxisID: 'y',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, padding: 14, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `  ${ctx.dataset.label}: ${formatMoeda(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11 }, callback: v => formatMoedaCurto(v) },
        },
      },
    },
  });
}

function _renderFluxoCanvas(canvas, lancamentos) {
  const meses = {};
  for (const l of lancamentos) {
    const key = `${l.data.getFullYear()}-${String(l.data.getMonth()+1).padStart(2,'0')}`;
    if (!meses[key]) meses[key] = { e: 0, s: 0 };
    if (l.tipo === 'credito') meses[key].e += l.valor;
    else                      meses[key].s += Math.abs(l.valor);
  }
  const keys = Object.keys(meses).sort();
  if (!keys.length) return;

  const labels   = keys.map(k => { const [y,m]=k.split('-'); return new Date(+y,+m-1,1).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}); });
  const entradas = keys.map(k => meses[k].e);
  const saidas   = keys.map(k => meses[k].s);
  let acum = 0;
  const acumulado = keys.map(k => { acum += meses[k].e - meses[k].s; return acum; });

  const W = canvas.offsetWidth || 600, H = 200;
  canvas.width = W; canvas.height = H;
  const pad = { top: 20, bottom: 40, left: 60, right: 20 };
  const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
  const maxVal = Math.max(...entradas, ...saidas, ...acumulado.map(Math.abs), 1);
  const gap    = Math.floor(cW / keys.length);
  const barW   = Math.max(6, Math.floor(gap / 3));

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + cH - (i/4)*cH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W-pad.right, y); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(formatMoedaCurto(maxVal*i/4), pad.left-4, y+3);
  }

  // Bars + line
  const pts = [];
  keys.forEach((k, i) => {
    const cx  = pad.left + i*gap + gap/2;
    const hE  = (entradas[i]/maxVal)*cH;
    const hS  = (saidas[i]/maxVal)*cH;
    ctx.fillStyle = '#22c55e'; ctx.fillRect(cx - barW - 1, pad.top+cH-hE, barW, hE);
    ctx.fillStyle = '#f87171'; ctx.fillRect(cx + 1,        pad.top+cH-hS, barW, hS);
    pts.push({ x: cx, y: pad.top + cH - (acumulado[i]/maxVal)*cH });
    ctx.fillStyle = '#64748b'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], cx, H-8);
  });

  // Accumulated line
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
  ctx.beginPath(); pts.forEach((p, i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y)); ctx.stroke();
  pts.forEach(p => { ctx.fillStyle='#2563eb'; ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); });

  // Legend
  [['█ Entradas','#22c55e'],['█ Saídas','#f87171'],['— Acumulado','#2563eb']].forEach(([t,c],i) => {
    ctx.fillStyle=c; ctx.font='11px sans-serif'; ctx.textAlign='left';
    ctx.fillText(t, W-160+i*0, 14+i*14);
  });
}

// ── Relatório Orçamento vs Realizado ──────────────────────────────────────
function relatorioOrcamento(lancamentos, dtI, dtF) {
  let html = cabecalhoRel('Orçamento vs Realizado', dtI, dtF);

  // Collect top-level Saída categories (direct children of each root group)
  const categorias = [];
  if (repo.root) {
    let grupo = repo.root.firstChild;
    while (grupo) {
      let filho = grupo.firstChild;
      while (filho) {
        if (filho.tipo === 'Saída') categorias.push(filho);
        filho = filho.nextSibling;
      }
      grupo = grupo.nextSibling;
    }
  }

  if (categorias.length === 0) {
    return html + `<p class="rel-empty">Nenhuma conta de saída encontrada no plano.</p>`;
  }

  // Filtered saídas (already date-filtered by gerarRelatorio)
  const saidas = lancamentos.filter(l => l.tipo === 'debito');

  const items = categorias.map(conta => {
    const subIds = new Set(coletarContas(conta).map(c => c.id));
    const realizado = saidas
      .filter(l => subIds.has(l.conta.id))
      .reduce((s, l) => s + Math.abs(l.valor), 0);
    const orcamento = conta.orcamento || 0;
    const pct      = orcamento > 0 ? (realizado / orcamento * 100) : null;
    const restante = orcamento > 0 ? Math.max(0, orcamento - realizado) : 0;
    const excedido = orcamento > 0 ? Math.max(0, realizado - orcamento) : 0;
    return { conta, orcamento, realizado, pct, restante, excedido };
  });

  // Sort: with budget first (desc by orcamento), then without
  items.sort((a, b) => {
    if (a.orcamento > 0 && b.orcamento === 0) return -1;
    if (a.orcamento === 0 && b.orcamento > 0) return 1;
    return b.orcamento - a.orcamento;
  });

  const comOrc  = items.filter(i => i.orcamento > 0);
  const totOrc  = comOrc.reduce((s, i) => s + i.orcamento, 0);
  const totReal = items.reduce((s, i) => s + i.realizado, 0);
  const totRest = Math.max(0, totOrc - totReal);
  const totPct  = totOrc > 0 ? (totReal / totOrc * 100) : 0;
  const totCor  = totPct > 100 ? '#dc2626' : totPct > 80 ? '#f59e0b' : '#16a34a';

  // Summary cards (4 columns — override the default 3-col grid)
  html += `
    <div class="rel-summary" style="grid-template-columns:repeat(4,1fr)">
      <div class="rel-summary-card saldo">
        <div class="label">Total Orçado</div>
        <div class="value">${formatMoeda(totOrc)}</div>
      </div>
      <div class="rel-summary-card saida">
        <div class="label">Realizado no Período</div>
        <div class="value">${formatMoeda(totReal)}</div>
      </div>
      <div class="rel-summary-card ${totReal > totOrc ? 'saida' : 'entrada'}">
        <div class="label">Restante</div>
        <div class="value">${formatMoeda(totRest)}</div>
      </div>
      <div class="rel-summary-card orcamento">
        <div class="label">% Utilizado</div>
        <div class="value" style="color:${totCor}">${totOrc > 0 ? totPct.toFixed(1) + '%' : '—'}</div>
      </div>
    </div>`;

  // Table
  html += `
    <div class="rel-section">
      <table class="rel-table">
        <thead>
          <tr>
            <th>Categoria</th>
            <th style="text-align:right">Orçamento</th>
            <th style="text-align:right">Realizado</th>
            <th style="text-align:right">Restante</th>
            <th style="min-width:200px">Execução</th>
          </tr>
        </thead>
        <tbody>`;

  for (const item of items) {
    const pct      = item.pct !== null ? item.pct : 0;
    const pctClamp = Math.min(pct, 100);
    const cor      = pct > 100 ? '#dc2626' : pct > 80 ? '#f59e0b' : '#16a34a';
    const barColor = pct > 100 ? '#dc2626' : pct > 80 ? '#f59e0b' : '#22c55e';
    const hasOrc   = item.orcamento > 0;

    html += `
      <tr>
        <td style="font-weight:600">${escapeHtml(item.conta.nome)}</td>
        <td class="td-num" style="color:#2563eb">${hasOrc ? formatMoeda(item.orcamento) : '—'}</td>
        <td class="td-num" style="color:${item.realizado > 0 ? '#dc2626' : '#94a3b8'}">${formatMoeda(item.realizado)}</td>
        <td class="td-num" style="color:${hasOrc ? (item.restante > 0 ? '#16a34a' : '#dc2626') : '#94a3b8'}">${hasOrc ? formatMoeda(item.restante) : '—'}</td>
        <td>
          ${hasOrc ? `
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;background:#f1f5f9;border-radius:4px;height:8px;min-width:80px;overflow:hidden">
                <div style="width:${pctClamp}%;height:100%;background:${barColor};border-radius:4px"></div>
              </div>
              <span style="font-size:12px;font-weight:700;color:${cor};min-width:44px;text-align:right">${pct.toFixed(1)}%</span>
            </div>
          ` : `<span style="font-size:12px;color:#94a3b8">Sem orçamento</span>`}
        </td>
      </tr>`;

    if (item.excedido > 0) {
      html += `
      <tr style="background:#fef2f2">
        <td colspan="5" style="font-size:12px;color:#dc2626;padding:4px 16px">
          ⚠ Orçamento excedido em ${formatMoeda(item.excedido)}
        </td>
      </tr>`;
    }
  }

  // Total row
  const totPctClamp = Math.min(totPct, 100);
  const totBarColor = totPct > 100 ? '#dc2626' : totPct > 80 ? '#f59e0b' : '#22c55e';
  html += `
      <tr style="background:#f1f5f9;font-weight:800;font-size:13px">
        <td>TOTAL GERAL</td>
        <td class="td-num" style="color:#2563eb">${formatMoeda(totOrc)}</td>
        <td class="td-num" style="color:#dc2626">${formatMoeda(totReal)}</td>
        <td class="td-num" style="color:${totRest > 0 ? '#16a34a' : '#dc2626'}">${formatMoeda(totRest)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;background:#e2e8f0;border-radius:4px;height:10px;min-width:80px;overflow:hidden">
              <div style="width:${totPctClamp}%;height:100%;background:${totBarColor};border-radius:4px"></div>
            </div>
            <span style="font-size:13px;font-weight:800;color:${totCor};min-width:44px;text-align:right">${totOrc > 0 ? totPct.toFixed(1) + '%' : '—'}</span>
          </div>
        </td>
      </tr>
      </tbody></table>
    </div>`;

  return html;
}

// ── Relatório Resumo Diário ───────────────────────────────────────────────
function relatorioResumoDiario(lancamentos, dtI, dtF) {
  let html = cabecalhoRel('Resumo Diário de Caixa', dtI, dtF);

  if (lancamentos.length === 0) {
    return html + `<p class="rel-empty">Nenhum lançamento no período selecionado.</p>`;
  }

  // Calcular saldo acumulado antes do período usando TODOS os lançamentos do repo
  let saldoAnterior = 0;
  if (repo.root) {
    const todos = [];
    function coletarTodos(c) {
      for (const l of c.lancamentos) {
        if (!l.data) continue;
        const d = new Date(l.data + 'T00:00:00');
        if (d < dtI) {
          todos.push(l.tipo === 'credito' ? l.valor : -l.valor);
        }
      }
      let f = c.firstChild;
      while (f) { coletarTodos(f); f = f.nextSibling; }
    }
    let r = repo.root.firstChild;
    while (r) { coletarTodos(r); r = r.nextSibling; }
    saldoAnterior = todos.reduce((s, v) => s + v, 0);
  }

  // Agrupar lançamentos do período por dia
  const dias = {};
  for (const l of lancamentos) {
    const key = l.data.toISOString().split('T')[0];
    if (!dias[key]) dias[key] = { entradas: 0, saidas: 0 };
    if (l.tipo === 'credito') dias[key].entradas += l.valor;
    else                      dias[key].saidas   += Math.abs(l.valor);
  }

  const keys = Object.keys(dias).sort();

  // Totais do período
  const totEntradas = lancamentos.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.valor, 0);
  const totSaidas   = lancamentos.filter(l => l.tipo === 'debito').reduce((s, l) => s + Math.abs(l.valor), 0);
  const saldoFinal  = saldoAnterior + totEntradas - totSaidas;

  html += `
    <div class="rel-summary" style="grid-template-columns:repeat(4,1fr)">
      <div class="rel-summary-card saldo">
        <div class="label">Saldo Inicial do Período</div>
        <div class="value">${formatMoeda(saldoAnterior)}</div>
      </div>
      <div class="rel-summary-card entrada">
        <div class="label">Total Entradas</div>
        <div class="value">${formatMoeda(totEntradas)}</div>
      </div>
      <div class="rel-summary-card saida">
        <div class="label">Total Saídas</div>
        <div class="value">${formatMoeda(totSaidas)}</div>
      </div>
      <div class="rel-summary-card saldo">
        <div class="label">Saldo Final do Período</div>
        <div class="value" style="color:${saldoFinal>=0?'#16a34a':'#dc2626'}">${formatMoeda(saldoFinal)}</div>
      </div>
    </div>`;

  html += `
    <div class="rel-section">
      <table class="rel-table">
        <thead>
          <tr>
            <th>Data</th>
            <th style="text-align:right">Saldo Inicial</th>
            <th style="text-align:right;color:#dc2626">Saídas</th>
            <th style="text-align:right;color:#16a34a">Entradas</th>
            <th style="text-align:right">Saldo Final</th>
          </tr>
        </thead>
        <tbody>`;

  let saldoDia = saldoAnterior;
  for (const key of keys) {
    const { entradas, saidas } = dias[key];
    const saldoIni = saldoDia;
    const saldoFin = saldoIni + entradas - saidas;
    const [ano, mes, dia] = key.split('-');
    const dataFmt = `${dia}/${mes}/${ano}`;

    html += `<tr>
      <td style="font-weight:600">${dataFmt}</td>
      <td class="td-num">${formatMoeda(saldoIni)}</td>
      <td class="td-num" style="color:${saidas>0?'#dc2626':'#94a3b8'}">${saidas>0 ? formatMoeda(saidas) : '—'}</td>
      <td class="td-num" style="color:${entradas>0?'#16a34a':'#94a3b8'}">${entradas>0 ? formatMoeda(entradas) : '—'}</td>
      <td class="td-num" style="color:${saldoFin>=0?'#16a34a':'#dc2626'};font-weight:700">${formatMoeda(saldoFin)}</td>
    </tr>`;

    saldoDia = saldoFin;
  }

  html += `
      <tr style="background:#f1f5f9;font-weight:800;font-size:13px">
        <td>Total Período</td>
        <td class="td-num">—</td>
        <td class="td-num" style="color:#dc2626">${formatMoeda(totSaidas)}</td>
        <td class="td-num" style="color:#16a34a">${formatMoeda(totEntradas)}</td>
        <td class="td-num" style="color:${saldoFinal>=0?'#16a34a':'#dc2626'}">${formatMoeda(saldoFinal)}</td>
      </tr>
      </tbody></table>
    </div>`;

  return html;
}

// ── Utilitário: valor abreviado ────────────────────────────────────────────
function formatMoedaCurto(v) {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `R$ ${(v/1_000).toFixed(1)}k`;
  return formatMoeda(v);
}

// ── Binding de eventos ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Datas padrão: primeiro e último dia do mês atual
  const hoje  = new Date();
  const dtIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const dtFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const fmtDate = d => d.toISOString().split('T')[0];
  if (relDtInicio) relDtInicio.value = fmtDate(dtIni);
  if (relDtFim)    relDtFim.value    = fmtDate(dtFim);

  // Legacy plano-view modal trigger (present only in old layout)
  if (btnRelatorio && modalRelatorio) {
    btnRelatorio.addEventListener('click', () => {
      modalRelatorio.style.display = 'flex';
      if (typeof trapFocus === 'function') trapFocus(modalRelatorio);
      if (relatorioResultado) relatorioResultado.innerHTML = `
        <div class="rel-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
          </svg>
          <p>Configure os filtros e clique em <strong>Gerar</strong> para visualizar o relatório.</p>
        </div>`;
    });
  }

  if (btnFecharRelatorio && modalRelatorio) {
    btnFecharRelatorio.addEventListener('click', () => { modalRelatorio.style.display = 'none'; });
  }

  if (modalRelatorio) {
    modalRelatorio.addEventListener('click', (e) => {
      if (e.target === modalRelatorio) modalRelatorio.style.display = 'none';
    });
  }

  if (btnGerarRelatorio) btnGerarRelatorio.addEventListener('click', gerarRelatorio);

  if (btnImprimirRel) {
    btnImprimirRel.addEventListener('click', () => {
      if (!relatorioResultado?.innerHTML.trim() || relatorioResultado.querySelector('.rel-empty')) {
        if (typeof showToast === 'function') showToast('Gere o relatório antes de imprimir.', 'warning');
        return;
      }
      window.print();
    });
  }
});

// Expõe funções puras para testes automatizados
try {
  window.coletarLancamentosReais = coletarLancamentosReais;
  window.coletarContas           = coletarContas;
  window.calcularTotalConta      = calcularTotalConta;
} catch(e) {}
