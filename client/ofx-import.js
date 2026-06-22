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
    // FITID é o identificador único do banco. Quando ausente, gera um fallback
    // estável por conteúdo para que reimportar o mesmo extrato deduplique.
    const fitId    = get('FITID') || ('ofx|' + dtPosted + '|' + amt + '|' + memo);

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

// Converte string numérica BR ("1.500,00") ou internacional ("1500.00")
// para Number, preservando o sinal (inclui "-200,00" e "(200,00)").
function _parseNum(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return NaN;
  const neg = /^-|-$|^\(/.test(s);
  let body = s.replace(/[^\d.,]/g, '');
  if (body.indexOf(',') >= 0) {
    // formato BR: ponto = separador de milhar, vírgula = decimal
    body = body.replace(/\./g, '').replace(',', '.');
  }
  // sem vírgula: o ponto (se houver) já é o separador decimal
  const n = parseFloat(body);
  if (isNaN(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

function _parseCSV(text) {
  const txns = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return txns;
  // Detecta separador
  const sep = lines[0].includes(';') ? ';' : ',';
  // Pular header se existir
  const start = /data|date|valor|value|hist|descr/i.test(lines[0]) ? 1 : 0;

  lines.slice(start).forEach((line) => {
    const cols = line.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cols.length < 2) return;

    // Primeira coluna: data (DD/MM/AAAA, DD-MM-AAAA ou AAAA-MM-DD)
    let data = '';
    const rawDate = cols[0];
    const dmatch = rawDate.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/);
    if (dmatch) {
      const year = dmatch[3].length === 2 ? '20' + dmatch[3] : dmatch[3];
      data = year + '-' + dmatch[2] + '-' + dmatch[1];
    } else {
      const iso = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
      data = iso ? iso[0] : new Date().toISOString().slice(0,10);
    }

    // Coluna de valor: prioriza colunas que "parecem" valor (têm separador
    // decimal ou sinal), evitando capturar nº de documento. Só cai para a 1ª
    // coluna numérica qualquer se nenhuma parecer valor.
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

    // Descrição: colunas restantes que não sejam outra coluna monetária (ex.: saldo)
    const descricao = cols.filter((c, idx) => {
      if (idx === 0 || idx === valIdx) return false;
      const isMoney = /[,.]/.test(c) && !isNaN(_parseNum(c));
      return !isMoney;
    }).join(' ').trim();

    // fitId estável por conteúdo → reimportar o mesmo CSV deduplica
    const fitId = 'csv|' + data + '|' + valor + '|' + tipo + '|' + descricao;
    txns.push({ fitId, tipo, valor, descricao, data, importar: true });
  });

  return txns;
}

// ── Coletar contas do repo ────────────────────────────────────────────────

function _getContaOptions() {
  const opts = [];
  if (typeof repo === 'undefined' || !repo._root) return opts;
  function _walk(c) {
    if (!c) return;
    // Só contas já persistidas (com db_id) podem receber lançamentos importados.
    if (!c.isRoot && c.db_id) {
      opts.push({ id: c.db_id, codigo: c.codigo_banco || '', nome: c.nome });
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
      contas.map(c => `<option value="${c.id}">${c.codigo ? c.codigo + ' — ' : ''}${c.nome}</option>`).join('');
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
  const contaId = document.getElementById('ofxContaSelect')?.value;
  if (!contaId) {
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

  // Uma única requisição em lote: evita o rate limit de escrita e deduplica
  // por fit_id no servidor (reimportar o mesmo extrato não duplica).
  let result = { type: 'error', text: 'Falha ao importar.' };
  try {
    const resp = await fetch(base + '/api/lancamentos/bulk', {
      method: 'POST',
      headers: _hdrs,
      credentials: 'include',
      body: JSON.stringify({
        conta_id: Number(contaId),
        lancamentos: para.map(t => ({
          data:      t.data,
          tipo:      t.tipo,
          valor:     t.valor,
          descricao: t.descricao || 'Importado OFX',
          fit_id:    t.fitId,
        })),
      }),
    });
    const j = await resp.json().catch(() => ({}));
    if (resp.ok && j && j.ok) {
      const plural = n => (n !== 1 ? 's' : '');
      let text = `${j.inserted} lançamento${plural(j.inserted)} importado${plural(j.inserted)}`;
      if (j.skipped) text += ` · ${j.skipped} duplicado${plural(j.skipped)} ignorado${plural(j.skipped)}`;
      result = { type: j.inserted ? 'success' : 'warning', text };
    } else {
      result = { type: 'error', text: (j && j.erro) || 'Falha ao importar.' };
    }
  } catch (e) {
    result = { type: 'error', text: 'Erro de rede ao importar.' };
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Importar'; }
  _fecharModalOFX();

  if (typeof showToast === 'function') showToast(result.text, result.type);

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
