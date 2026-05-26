// API_BASE: usa o valor definido por auth.js (window.API_BASE) ou detecta pelo protocolo
const API_BASE = (typeof window !== 'undefined' && window.API_BASE)
  ? window.API_BASE
  : (location.protocol === 'file:' ? 'http://localhost:3000' : '');

let _state = { page: 1, pages: 1, total: 0, limit: 100, lastFilters: {} };

function filtros() {
  return {
    dtI:        document.getElementById('filtroDataI').value || undefined,
    dtF:        document.getElementById('filtroDataF').value || undefined,
    entityType: document.getElementById('filtroEntityType').value || undefined,
    action:     document.getElementById('filtroAction').value || undefined,
    page:       _state.page,
    limit:      _state.limit,
  };
}

function setConteudo(html) {
  document.getElementById('conteudo').innerHTML = html;
}

async function carregar() {
  setConteudo('<div class="loading">Carregando...</div>');
  const f = filtros();
  _state.lastFilters = f;
  const qs = Object.entries(f)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&');
  try {
    const resp = await fetch(API_BASE + '/api/audit' + (qs ? '?' + qs : ''), {
      credentials: 'include'
    });
    const text = await resp.text();
    if (!resp.ok) {
      setConteudo('<div class="empty erro">&#10060; Erro HTTP ' + resp.status + '<br><pre>' + text.slice(0, 500) + '</pre></div>');
      return;
    }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      setConteudo('<div class="empty erro">&#10060; Resposta inválida:<br><pre>' + text.slice(0, 500) + '</pre></div>');
      return;
    }
    if (!data.ok) {
      setConteudo('<div class="empty erro">&#10060; ' + (data.erro || 'Erro desconhecido') + '</div>');
      return;
    }
    _state.total = data.total || 0;
    _state.page  = data.page  || 1;
    _state.pages = data.pages || 1;
    renderTabela(data.entries || []);
    document.getElementById('infoBar').textContent =
      _state.total + ' registro' + (_state.total !== 1 ? 's' : '') + ' encontrado' + (_state.total !== 1 ? 's' : '');
    const pag = document.getElementById('paginacao');
    pag.style.display = _state.pages > 1 ? '' : 'none';
    document.getElementById('paginaInfo').textContent = 'Página ' + _state.page + ' de ' + _state.pages;
    document.getElementById('btnPrev').disabled = _state.page <= 1;
    document.getElementById('btnNext').disabled = _state.page >= _state.pages;
  } catch (e) {
    setConteudo('<div class="empty erro">&#10060; Erro de conexão: ' + e.message + '</div>');
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLORS = {
  login: '#16a34a', failed_login: '#dc2626',
  conta_criada: '#2563eb', conta_editada: '#f59e0b', conta_deletada: '#dc2626',
  lancamento_criado: '#2563eb', lancamento_editado: '#f59e0b', lancamento_deletado: '#dc2626',
  create_user: '#7c3aed', update_user: '#f59e0b', remove_user: '#dc2626',
  reset_password: '#f59e0b', change_password: '#f59e0b', token_renovado: '#64748b',
};

function renderTabela(entries) {
  if (!entries.length) {
    setConteudo('<div class="empty">Nenhum registro encontrado.</div>');
    return;
  }
  let html = '<table><thead><tr>' +
    '<th>Data / Hora</th><th>Ação</th><th>Entidade</th><th>ID/Código</th><th>Ator</th><th>IP</th><th>Detalhes</th>' +
    '</tr></thead><tbody>';
  for (const e of entries) {
    const color = COLORS[e.action] || '#64748b';
    const when = e.when ? new Date(e.when).toLocaleString('pt-BR') : '—';
    const tipoMap = { conta: 'Conta', lancamento: 'Lançamento', usuario: 'Usuário' };
    const tipo = tipoMap[e.entityType] || (e.entityType || '—');
    const detalhe = e.detail ? JSON.stringify(e.detail, null, 1) : '—';
    html += '<tr>' +
      '<td style="white-space:nowrap">' + esc(when) + '</td>' +
      '<td><span class="badge" style="background:' + color + '20;color:' + color + ';border-color:' + color + '40">' + esc(e.action) + '</span></td>' +
      '<td>' + esc(tipo) + '</td>' +
      '<td>' + esc(e.entityId || '—') + '</td>' +
      '<td>' + esc(e.actorUserId != null ? e.actorUserId : '—') + '</td>' +
      '<td>' + esc(e.ip || '—') + '</td>' +
      '<td class="detail-cell">' + esc(detalhe) + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  setConteudo(html);
}

function exportCSV() {
  const f = _state.lastFilters;
  const params = Object.assign({}, f, { limit: 9999, page: 1 });
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&');
  fetch(API_BASE + '/api/audit?' + qs, { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) { alert('Erro ao exportar.'); return; }
      const rows = [['Data/Hora', 'Ação', 'Entidade', 'ID', 'Ator', 'IP', 'Detalhes']];
      for (const e of data.entries || []) {
        rows.push([
          e.when ? new Date(e.when).toLocaleString('pt-BR') : '',
          e.action || '', e.entityType || '', e.entityId || '',
          e.actorUserId != null ? e.actorUserId : '',
          e.ip || '', e.detail ? JSON.stringify(e.detail) : ''
        ]);
      }
      const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'audit_logs.csv';
      a.click();
    });
}

document.addEventListener('DOMContentLoaded', function () {

  document.getElementById('btnVoltar').addEventListener('click', function () { history.back(); });
  document.getElementById('btnBuscar').addEventListener('click', function () { _state.page = 1; carregar(); });
  document.getElementById('btnLimpar').addEventListener('click', function () {
    document.getElementById('filtroDataI').value = '';
    document.getElementById('filtroDataF').value = '';
    document.getElementById('filtroEntityType').value = '';
    document.getElementById('filtroAction').value = '';
    _state.page = 1;
    setConteudo('<div class="loading">Use os filtros acima e clique em Buscar.</div>');
    document.getElementById('infoBar').textContent = '';
    document.getElementById('paginacao').style.display = 'none';
  });
  document.getElementById('btnPrev').addEventListener('click', function () {
    if (_state.page > 1) { _state.page--; carregar(); }
  });
  document.getElementById('btnNext').addEventListener('click', function () {
    if (_state.page < _state.pages) { _state.page++; carregar(); }
  });
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

  // Carregar automaticamente
  carregar();
});
