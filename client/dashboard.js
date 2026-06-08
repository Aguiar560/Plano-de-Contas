/**
 * dashboard.js — Dashboard financeiro
 * KPIs, gráfico de evolução mensal, distribuição de saídas, lançamentos recentes
 */
'use strict';

let _dashChartEvolucao     = null;
let _dashChartDistribuicao = null;
let _dashInitialized       = false;

// ── Helpers ────────────────────────────────────────────────────────────
function _fmtMoeda(v) {
  return 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _fmtMoedaCompact(v) {
  if (v >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return 'R$ ' + (v / 1e3).toFixed(0) + 'k';
  return 'R$ ' + v.toFixed(0);
}

function _fmtData(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _isoToday() {
  return new Date().toISOString().split('T')[0];
}

function _isoFirstOfMonth(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}

function _isoLastOfMonth(date) {
  const d = date || new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().split('T')[0];
}

// ── Collect all lançamentos in a date range ────────────────────────────
function _coletarLancsRange(dtIso, dtFIso) {
  const arr = [];
  if (!window.repo || !repo.root) return arr;

  const dtI = new Date(dtIso  + 'T00:00:00');
  const dtF = new Date(dtFIso + 'T23:59:59');

  function percorrer(conta) {
    for (const l of conta.lancamentos) {
      if (!l.data) continue;
      const d = new Date(l.data + 'T00:00:00');
      if (d >= dtI && d <= dtF) {
        arr.push({ ...l, conta, dataObj: d });
      }
    }
    let c = conta.firstChild;
    while (c) { percorrer(c); c = c.nextSibling; }
  }

  let c = repo.root.firstChild;
  while (c) { percorrer(c); c = c.nextSibling; }

  return arr.sort((a, b) => b.dataObj - a.dataObj);
}

// ── Get top-level category name for a given account ────────────────────
function _categoria(conta) {
  let c = conta;
  // Walk up until direct child of ENTRADAS/SAIDAS root
  while (c && c.parent && c.parent.parent && !c.parent.parent.isRoot) {
    c = c.parent;
  }
  return c ? c.nome : conta.nome;
}

// ── Compute total orçamento for saídas ────────────────────────────────
// Soma apenas os filhos diretos de cada grupo raiz (ex: SAÍDAS > COMBUSTÍVEIS)
// sem descer nos netos, evitando double-counting pai + filho.
function _calcOrcTotal() {
  if (!window.repo || !repo.root) return 0;
  let total = 0;
  let grupo = repo.root.firstChild;           // percorre ENTRADAS, SAÍDAS…
  while (grupo) {
    let filho = grupo.firstChild;             // percorre COMBUSTÍVEIS, ALIMENTAÇÃO…
    while (filho) {
      if (filho.tipo === 'Saída') total += (filho.orcamento || 0);
      filho = filho.nextSibling;
    }
    grupo = grupo.nextSibling;
  }
  return total;
}

// ── Set dashboard period from buttons ─────────────────────────────────
function _applyPeriod(periodKey) {
  const hoje = new Date();
  let dtI, dtF;

  switch (periodKey) {
    case 'mes':
      dtI = _isoFirstOfMonth(hoje);
      dtF = _isoToday();
      break;
    case 'trimestre': {
      const q = Math.floor(hoje.getMonth() / 3);
      dtI = new Date(hoje.getFullYear(), q * 3, 1).toISOString().split('T')[0];
      dtF = _isoToday();
      break;
    }
    case 'ano':
      dtI = `${hoje.getFullYear()}-01-01`;
      dtF = _isoToday();
      break;
    default:
      return;
  }

  document.getElementById('dashDtI').value = dtI;
  document.getElementById('dashDtF').value = dtF;
}

// ── Init ───────────────────────────────────────────────────────────────
function initDashboard() {
  if (_dashInitialized) return;
  _dashInitialized = true;

  // Set default period
  _applyPeriod('mes');

  // Period buttons (desktop)
  document.querySelectorAll('#view-dashboard .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-dashboard .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sel = document.getElementById('dashPeriodSel');
      if (sel) sel.value = btn.dataset.period;
      _applyPeriod(btn.dataset.period);
      updateDashboard();
    });
  });

  // Period select (mobile)
  const dashPeriodSel = document.getElementById('dashPeriodSel');
  if (dashPeriodSel) {
    dashPeriodSel.addEventListener('change', () => {
      const period = dashPeriodSel.value;
      document.querySelectorAll('#view-dashboard .period-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === period);
      });
      _applyPeriod(period);
      updateDashboard();
    });
  }

  document.getElementById('btnDashAplicar')?.addEventListener('click', () => {
    document.querySelectorAll('#view-dashboard .period-btn').forEach(b => b.classList.remove('active'));
    const sel = document.getElementById('dashPeriodSel');
    if (sel) sel.value = '';
    updateDashboard();
  });
}

// ── Main update ───────────────────────────────────────────────────────
function updateDashboard() {
  initDashboard();

  const dtI = document.getElementById('dashDtI')?.value;
  const dtF = document.getElementById('dashDtF')?.value;

  if (!dtI || !dtF) return;
  if (!window.repo || !repo.root) {
    _renderDashboardEmpty();
    return;
  }

  const todos   = _coletarLancsRange(dtI, dtF);
  const entradas = todos.filter(l => l.tipo === 'credito');
  const saidas   = todos.filter(l => l.tipo === 'debito');

  const totalE = entradas.reduce((s, l) => s + l.valor, 0);
  const totalS = saidas.reduce((s, l) => s + l.valor, 0);
  const saldo  = totalE - totalS;

  // ── KPI: Entradas
  document.getElementById('kpiEntradas').textContent = _fmtMoeda(totalE);
  document.getElementById('kpiEntradasPeriod').textContent =
    entradas.length + (entradas.length === 1 ? ' lançamento' : ' lançamentos');

  // ── KPI: Saídas
  document.getElementById('kpiSaidas').textContent = _fmtMoeda(totalS);
  document.getElementById('kpiSaidasPeriod').textContent =
    saidas.length + (saidas.length === 1 ? ' lançamento' : ' lançamentos');

  // ── KPI: Saldo
  const kpiSaldo = document.getElementById('kpiSaldo');
  kpiSaldo.textContent = _fmtMoeda(saldo);
  kpiSaldo.style.color = saldo >= 0 ? 'var(--c-entrada)' : 'var(--c-saida)';

  const statusEl = document.getElementById('kpiSaldoStatus');
  if (statusEl) {
    statusEl.textContent = saldo >= 0 ? 'Resultado positivo' : 'Resultado negativo';
    statusEl.className   = 'kpi-change ' + (saldo >= 0 ? 'up' : 'down');
  }

  // ── KPI: Orçamento
  const orcTotal = _calcOrcTotal();
  const kpiOrcEl = document.getElementById('kpiOrcamento');
  const kpiOrcLb = document.getElementById('kpiOrcLabel');
  if (orcTotal > 0) {
    const pct = Math.round((totalS / orcTotal) * 100);
    kpiOrcEl.textContent = pct + '%';
    kpiOrcLb.textContent = 'de ' + _fmtMoeda(orcTotal) + ' orçados';
    kpiOrcLb.className   = 'kpi-change ' + (pct > 100 ? 'down' : pct >= 80 ? 'alert' : 'up');
  } else {
    kpiOrcEl.textContent = '—';
    kpiOrcLb.textContent = 'Sem orçamento definido';
    kpiOrcLb.className   = 'kpi-change neutral';
  }

  // ── Charts
  _renderEvolucaoChart();
  _renderDistribuicaoChart(saidas);

  // ── Recent transactions
  _renderRecentTransactions(todos);
}

// ── Chart: Evolução mensal (últimos 6 meses) ──────────────────────────
function _renderEvolucaoChart() {
  const canvas = document.getElementById('chartEvolucao');
  if (!canvas || typeof Chart === 'undefined') return;

  const hoje = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    months.push({
      label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      year:  d.getFullYear(),
      month: d.getMonth(),
    });
  }

  const dataEntradas = months.map(m => {
    const dtI = `${m.year}-${String(m.month+1).padStart(2,'0')}-01`;
    const last = new Date(m.year, m.month + 1, 0);
    const dtF = last.toISOString().split('T')[0];
    return _coletarLancsRange(dtI, dtF)
      .filter(l => l.tipo === 'credito')
      .reduce((s, l) => s + l.valor, 0);
  });

  const dataSaidas = months.map(m => {
    const dtI = `${m.year}-${String(m.month+1).padStart(2,'0')}-01`;
    const last = new Date(m.year, m.month + 1, 0);
    const dtF = last.toISOString().split('T')[0];
    return _coletarLancsRange(dtI, dtF)
      .filter(l => l.tipo === 'debito')
      .reduce((s, l) => s + l.valor, 0);
  });

  if (_dashChartEvolucao) { _dashChartEvolucao.destroy(); _dashChartEvolucao = null; }

  _dashChartEvolucao = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        {
          label: 'Entradas',
          data: dataEntradas,
          backgroundColor: 'rgba(16,185,129,0.8)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: false,
        },
        {
          label: 'Saídas',
          data: dataSaidas,
          backgroundColor: 'rgba(239,68,68,0.8)',
          borderColor: '#ef4444',
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, padding: 16, font: { size: 12, family: 'Inter' } },
        },
        tooltip: {
          callbacks: {
            label: ctx => `  ${ctx.dataset.label}: ${_fmtMoeda(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 12 } } },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 11 },
            callback: v => _fmtMoedaCompact(v),
          },
        },
      },
    },
  });
}

// ── Chart: Distribuição de saídas por categoria ───────────────────────
function _renderDistribuicaoChart(saidas) {
  const canvas   = document.getElementById('chartDistribuicao');
  const emptyMsg = document.getElementById('chartDistEmpty');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_dashChartDistribuicao) { _dashChartDistribuicao.destroy(); _dashChartDistribuicao = null; }

  if (saidas.length === 0) {
    canvas.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = '';
    return;
  }

  canvas.style.display = '';
  if (emptyMsg) emptyMsg.style.display = 'none';

  // Group by top-level category
  const bycat = {};
  for (const l of saidas) {
    const cat = _categoria(l.conta);
    bycat[cat] = (bycat[cat] || 0) + l.valor;
  }

  const sorted = Object.entries(bycat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const palette = [
    '#ef4444','#f97316','#f59e0b','#84cc16',
    '#10b981','#06b6d4','#3b82f6','#8b5cf6',
  ];

  _dashChartDistribuicao = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([k]) => k.length > 18 ? k.slice(0, 17) + '…' : k),
      datasets: [{
        data:            sorted.map(([, v]) => v),
        backgroundColor: palette,
        borderWidth:     0,
        hoverOffset:     8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, padding: 10, font: { size: 11, family: 'Inter' } },
        },
        tooltip: {
          callbacks: {
            label: ctx => `  ${ctx.label}: ${_fmtMoeda(ctx.raw)}`,
          },
        },
      },
      cutout: '62%',
    },
  });
}

// ── Recent transactions table ─────────────────────────────────────────
function _renderRecentTransactions(todos) {
  const tbody = document.getElementById('dashRecentLanc');
  if (!tbody) return;

  const recent = todos.slice(0, 10);

  if (recent.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:32px;color:var(--c-text-muted);font-size:13px">
          Nenhum lançamento no período selecionado
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = recent.map(l => {
    const isEntrada = l.tipo === 'credito';
    return `
      <tr>
        <td style="white-space:nowrap;color:var(--c-text-muted);font-size:12.5px">${_fmtData(l.data)}</td>
        <td>
          <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${_esc(l.conta.nome)}</div>
        </td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${_esc(l.descricao)}</td>
        <td>
          <span class="type-badge ${isEntrada ? 'entrada' : 'saida'}">
            ${isEntrada ? 'Entrada' : 'Saída'}
          </span>
        </td>
        <td class="td-num" style="color:${isEntrada ? 'var(--c-entrada)' : 'var(--c-saida)'}">
          ${isEntrada ? '+' : '-'}${_fmtMoeda(l.valor)}
        </td>
      </tr>`;
  }).join('');
}

// ── Empty state when no data ───────────────────────────────────────────
function _renderDashboardEmpty() {
  ['kpiEntradas','kpiSaidas','kpiSaldo','kpiOrcamento'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = 'R$ 0,00';
  });

  const tbody = document.getElementById('dashRecentLanc');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:32px;color:var(--c-text-muted);font-size:13px">
          Nenhum dado disponível
        </td>
      </tr>`;
  }
}

// ── Listen for data changes (dispatched by app.js) ────────────────────
window.addEventListener('saldo:update', () => {
  if (typeof _currentView !== 'undefined' && window._currentView === 'dashboard') {
    updateDashboard();
  }
});

window.addEventListener('plano:loaded', () => {
  const dashView = document.getElementById('view-dashboard');
  if (dashView && dashView.classList.contains('active')) updateDashboard();
});

// Expose globally
window.updateDashboard = updateDashboard;
window.initDashboard   = initDashboard;

// Expõe funções puras para testes automatizados
try {
  window._fmtMoeda         = _fmtMoeda;
  window._fmtMoedaCompact  = _fmtMoedaCompact;
  window._fmtData          = _fmtData;
  window._esc              = _esc;
  window._isoToday         = _isoToday;
  window._isoFirstOfMonth  = _isoFirstOfMonth;
  window._isoLastOfMonth   = _isoLastOfMonth;
  window._applyPeriod      = _applyPeriod;
} catch(e) {}
