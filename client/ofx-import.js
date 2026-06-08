/**
 * ofx-import.js — Importação de extratos bancários OFX e CSV
 * Parseia o arquivo, exibe preview mapeável e cria lançamentos via API.
 */
'use strict';

let _ofxTransacoes = [];  // transações parseadas
let _ofxContaId    = null;

// ── Parser OFX ────────────────────────────────────────────────────────────

function _parseOFX(text) {
  const txns = [];
  // Normaliza quebras e extrai blocos STMTTRN
  const blocks = text.replace(/\r\n/g, '\n').match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

  blocks.forEach((block, i) => {
    const get = tag => {
      const m = block.match(new RegExp('<' + tag + '>([^<\\n]+)', 'i'));
      return m ? m[1].trim() : '';
    };

    const trnType  = get('TRNTYPE').toUpperCase();  // DEBIT | CREDIT | CHECK | INT ...
    const dtPosted = get('DTPOSTED').slice(0, 8);   // YYYYMMDD
    const amt      = parseFloat(get('TRNAMT').replace(',', '.'));
    const memo     = get('MEMO') || get('NAME') || '';
    const fitId    = get('FITID') || String(i);

    if (isNaN(amt)) return;

    // Determina tipo: débito = saída, crédito = entrada
    const tipo = (amt < 0 || trnType === 'DEBIT' || trnType === 'CHECK') ? 'debito' : 'credito';
    const valor = Math.abs(amt);

    // Converte YYYYMMDD → YYYY-MM-DD
    const data = dtPosted.length >= 8
      ? dtPosted.slice(0,4) + '-' + dtPosted.slice(4,6) + '-' + dtPosted.slice(6,8)
      : new Date().toISOString().slice(0,10);

    txns.push({ fitId, tipo, valor, descricao: memo, data, importar: true });
  });

  return txns;
}

function _parseCSV(text) {
  const txns = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  // Detecta separador
  const sep = lines[0].includes(';') ? ';' : ',';
  // Pular header se existir
  const start = /data|date|valor|value/i.test(lines[0]) ? 1 : 0;

  lines.slice(start).forEach((line, i) => {
    const cols = line.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cols.length < 2) return;

    // Tenta detectar colunas: data, valor, descrição (em qualquer ordem razoável)
    // Formato esperado: data, descrição, valor  OU  data, valor, descrição
    let data = '', descricao = '', valor = 0, tipo = 'debito';

    // Primeira coluna: data
    const rawDate = cols[0];
    const dmatch = rawDate.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/);
    if (dmatch) {
      const year = dmatch[3].length === 2 ? '20' + dmatch[3] : dmatch[3];
      data = year + '-' + dmatch[2] + '-' + dmatch[1];
    } else {
      const iso = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
      data = iso ? iso[0] : new Date().toISOString().slice(0,10);
    }

    // Detecta coluna de valor (número com ponto ou vírgula)
    let valIdx = -1;
    for (let c = 1; c < cols.length; c++) {
      const n = parseFloat(cols[c].replace(/\./g, '').replace(',', '.'));
      if (!isNaN(n) && n !== 0) { valIdx = c; valor = Math.abs(n); tipo = n < 0 ? 'debito' : 'credito'; break; }
    }

    // Restante é descrição
    descricao = cols.filter((_, idx) => idx !== 0 && idx !== valIdx).join(' ').trim();

    if (!valor || !data) return;
    txns.push({ fitId: 'csv_' + i, tipo, valor, descricao, data, importar: true });
  });

  return txns;
}

// ── Coletar contas do repo ────────────────────────────────────────────────

function _getContaOptions() {
  const opts = [];
  if (typeof repo === 'undefined' || !repo._root) return opts;
  function _walk(c) {
    if (!c) return;
    if (!c.isRoot) {
      opts.push({ id: c.id, codigo: c.codigo_banco || '', nome: c.nome });
    }
    let ch = c.firstChild;
    while (ch) { _walk(ch); ch = ch.nextSibling; }
  }
  _walk(repo._root);
  return opts;
}

// ── Render modal steps ────────────────────────────────────────────────────

function _setOFXButtons(step) {
  const btnProx  = document.getElementById('btnOfxProximo');
  const btnVolt  = document.getElementById('btnOfxVoltar');
  const btnImp   = document.getElementById('btnOfxImportar');
  if (!btnProx) return;
  if (step === 1) {
    btnProx.style.display = ''; btnVolt.style.display = 'none'; btnImp.style.display = 'none';
    btnProx.disabled = !_ofxTransacoes.length;
  } else {
    btnProx.style.display = 'none'; btnVolt.style.display = ''; btnImp.style.display = '';
    btnImp.disabled = false;
  }
}

function _renderStep1() {
  const modal = document.getElementById('modalImportOFX');
  if (!modal) return;
  modal.querySelector('#ofxStep1').style.display = '';
  modal.querySelector('#ofxStep2').style.display = 'none';
  _setOFXButtons(1);
}

function _renderStep2() {
  const modal = document.getElementById('modalImportOFX');
  if (!modal) return;
  modal.querySelector('#ofxStep1').style.display = 'none';
  modal.querySelector('#ofxStep2').style.display = '';

  const contas = _getContaOptions();
  const sel = document.getElementById('ofxContaSelect');
  if (sel) {
    sel.innerHTML = '<option value="">— Selecione a conta destino —</option>' +
      contas.map(c => `<option value="${c.codigo}">${c.codigo ? c.codigo + ' — ' : ''}${c.nome}</option>`).join('');
    if (_ofxContaId) sel.value = _ofxContaId;
  }

  _renderTabelaPreview();
  _setOFXButtons(2);
}

function _renderTabelaPreview() {
  const tbody = document.getElementById('ofxPreviewBody');
  if (!tbody) return;

  const fmt = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  tbody.innerHTML = _ofxTransacoes.map((t, i) => `
    <div class="ofx-row">
      <span style="font-size:12.5px">${t.data}</span>
      <span style="font-size:12.5px;font-weight:600;color:${t.tipo === 'debito' ? '#dc2626' : '#16a34a'}">${fmt(t.valor)}</span>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;justify-content:center">
        <input type="checkbox" data-tidx="${i}" ${t.importar ? 'checked' : ''} style="accent-color:var(--c-primary)">
        <span style="font-size:11.5px;color:var(--c-text-muted)">${t.tipo === 'debito' ? 'Débito' : 'Crédito'}</span>
      </label>
      <span style="font-size:12px;color:var(--c-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${t.descricao}">${t.descricao || '—'}</span>
    </div>
  `).join('');

  // Sincroniza estado de importar
  tbody.querySelectorAll('input[data-tidx]').forEach(cb => {
    cb.addEventListener('change', () => {
      _ofxTransacoes[+cb.dataset.tidx].importar = cb.checked;
      _atualizarContadorImport();
    });
  });
  _atualizarContadorImport();
}

function _atualizarContadorImport() {
  const count = _ofxTransacoes.filter(t => t.importar).length;
  const el = document.getElementById('ofxImportCount');
  if (el) el.textContent = `${count} lançamento${count !== 1 ? 's' : ''} selecionado${count !== 1 ? 's' : ''}`;
}

// ── Import ────────────────────────────────────────────────────────────────

async function _executarImport() {
  const contaCodigo = document.getElementById('ofxContaSelect')?.value;
  if (!contaCodigo) {
    if (typeof showToast === 'function') showToast('Selecione a conta destino.', 'warning');
    return;
  }

  const para = _ofxTransacoes.filter(t => t.importar);
  if (!para.length) {
    if (typeof showToast === 'function') showToast('Nenhum lançamento selecionado.', 'warning');
    return;
  }

  const btn = document.getElementById('btnOfxImportar');
  if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }

  const base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
  const _token = (() => {
    try { const s = JSON.parse(sessionStorage.getItem('plano_auth_session_v1') || '{}'); return s.token || null; } catch(e) { return null; }
  })();
  const _hdrs = { 'Content-Type': 'application/json' };
  if (_token) _hdrs['Authorization'] = 'Bearer ' + _token;
  let ok = 0, errs = 0;

  for (const t of para) {
    try {
      const resp = await fetch(base + '/api/lancamentos', {
        method: 'POST',
        headers: _hdrs,
        credentials: 'include',
        body: JSON.stringify({
          conta_codigo: contaCodigo,
          data:         t.data,
          tipo:         t.tipo,
          valor:        t.valor,
          descricao:    t.descricao || 'Importado OFX'
        })
      });
      if (resp && resp.ok) ok++; else errs++;
    } catch(e) { errs++; }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Importar'; }
  _fecharModalOFX();

  const msg = `${ok} lançamento${ok !== 1 ? 's' : ''} importado${ok !== 1 ? 's' : ''}` + (errs ? ` (${errs} erro${errs !== 1 ? 's' : ''})` : '');
  if (typeof showToast === 'function') showToast(msg, errs ? 'warning' : 'success');

  // Recarregar árvore
  if (typeof repo !== 'undefined' && typeof repo.carregarDoBanco === 'function') {
    await repo.carregarDoBanco();
    if (typeof renderTree === 'function') renderTree();
    if (typeof updateDashboard === 'function') updateDashboard();
  }
}

// ── Abrir / fechar ────────────────────────────────────────────────────────

function abrirModalOFX() {
  if (!auth.can('newLancamento')) {
    if (typeof showToast === 'function') showToast('Sem permissão para criar lançamentos.', 'warning');
    return;
  }
  _ofxTransacoes = [];
  _ofxContaId = null;
  const modal = document.getElementById('modalImportOFX');
  if (!modal) return;
  _renderStep1();
  modal.style.display = 'flex';
}

function _fecharModalOFX() {
  const modal = document.getElementById('modalImportOFX');
  if (modal) modal.style.display = 'none';
}

// ── Wiring ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Drop zone
  const dz = document.getElementById('ofxDropZone');
  if (dz) {
    dz.addEventListener('click', () => document.getElementById('ofxFileInput')?.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) _processFile(f);
    });
  }

  document.getElementById('ofxFileInput')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) _processFile(f);
    e.target.value = '';
  });

  document.getElementById('btnOfxProximo')?.addEventListener('click', () => {
    if (!_ofxTransacoes.length) {
      if (typeof showToast === 'function') showToast('Carregue um arquivo OFX ou CSV primeiro.', 'warning');
      return;
    }
    _renderStep2();
  });

  document.getElementById('btnOfxVoltar')?.addEventListener('click', _renderStep1);
  document.getElementById('btnOfxImportar')?.addEventListener('click', _executarImport);

  document.getElementById('btnFecharModalOFX')?.addEventListener('click', _fecharModalOFX);
  document.getElementById('btnCancelarOFX')?.addEventListener('click', _fecharModalOFX);
  document.getElementById('modalImportOFX')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modalImportOFX')) _fecharModalOFX();
  });

  document.getElementById('btnAbrirImportOFX')?.addEventListener('click', abrirModalOFX);

  // Selecionar/desselecionar todos
  document.getElementById('ofxCheckAll')?.addEventListener('change', e => {
    _ofxTransacoes.forEach(t => t.importar = e.target.checked);
    _renderTabelaPreview();
  });
});

function _processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = ev => {
    const text = ev.target.result;
    _ofxTransacoes = ext === 'csv' ? _parseCSV(text) : _parseOFX(text);

    const info = document.getElementById('ofxFileInfo');
    if (info) info.textContent = `${file.name} — ${_ofxTransacoes.length} transação(ões) encontrada(s)`;

    _setOFXButtons(1);
  };
  reader.readAsText(file, 'latin1');
}

window.abrirModalOFX = abrirModalOFX;
