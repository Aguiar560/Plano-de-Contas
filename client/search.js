/**
 * search.js — Busca global (Ctrl+K)
 * Pesquisa contas, lançamentos e fornecedores em tempo real.
 */
'use strict';

let _searchOpen = false;
let _searchFocusIdx = -1;
let _searchResults = [];

// ── Coletar dados da árvore flat ──────────────────────────────────────────

function _collectContas() {
  const out = [];
  if (typeof repo === 'undefined' || !repo._root) return out;
  function _walk(c) {
    if (!c || c.isRoot) { let ch = c && c.firstChild; while(ch) { _walk(ch); ch = ch.nextSibling; } return; }
    out.push({ type: 'conta', id: c.id, codigo: c.codigo_banco || '', nome: c.nome, natureza: c.natureza_banco || '' });
    let ch = c.firstChild;
    while (ch) { _walk(ch); ch = ch.nextSibling; }
  }
  _walk(repo._root);
  return out;
}

function _collectLancamentos() {
  const out = [];
  if (typeof repo === 'undefined' || !repo._root) return out;
  function _walk(c) {
    if (!c) return;
    if (!c.isRoot) {
      (c.lancamentos || []).forEach(l => {
        out.push({
          type: 'lancamento',
          id: l.id,
          db_id: l.db_id,
          descricao: l.descricao || '',
          valor: l.valor,
          data: l.data,
          tipo: l.tipo,
          contaNome: c.nome,
          contaId: c.id,
          contaCodigo: c.codigo_banco || '',
        });
      });
    }
    let ch = c.firstChild;
    while (ch) { _walk(ch); ch = ch.nextSibling; }
  }
  _walk(repo._root);
  return out;
}

function _collectFornecedores() {
  if (typeof fornRepo === 'undefined') return [];
  return (fornRepo.getAll() || []).map(f => ({
    type: 'fornecedor',
    id: f.id,
    nome: f.nome || '',
    doc: f.tipoPessoa === 'fisica' ? (f.cpf || '') : (f.cnpj || ''),
    tipoPessoa: f.tipoPessoa || 'juridica',
  }));
}

// ── Busca ─────────────────────────────────────────────────────────────────

function _search(q) {
  if (!q || q.length < 2) return { contas: [], lancamentos: [], fornecedores: [] };
  const term = q.toLowerCase().trim();

  const contas = _collectContas().filter(c =>
    c.nome.toLowerCase().includes(term) || c.codigo.includes(term)
  ).slice(0, 6);

  const lancamentos = _collectLancamentos().filter(l =>
    l.descricao.toLowerCase().includes(term) ||
    String(l.valor).includes(term) ||
    (l.data && l.data.includes(term))
  ).slice(0, 8);

  const fornecedores = _collectFornecedores().filter(f =>
    f.nome.toLowerCase().includes(term) || f.doc.includes(term)
  ).slice(0, 4);

  return { contas, lancamentos, fornecedores };
}

// ── Renderização ──────────────────────────────────────────────────────────

function _fmtValor(v, tipo) {
  const s = Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return tipo === 'debito' ? '− ' + s : '+ ' + s;
}

function _renderResults(data) {
  const box = document.getElementById('searchResults');
  if (!box) return;

  _searchResults = [];
  let html = '';

  if (!data.contas.length && !data.lancamentos.length && !data.fornecedores.length) {
    box.innerHTML = '<div class="search-palette-empty">Nenhum resultado encontrado.</div>';
    return;
  }

  if (data.contas.length) {
    html += `<div class="search-palette-group">Contas</div>`;
    data.contas.forEach(c => {
      _searchResults.push({ ...c });
      html += `
        <div class="search-palette-item" data-ridx="${_searchResults.length - 1}">
          <div class="search-palette-item-icon" style="background:#eff6ff">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          </div>
          <div>
            <div class="search-palette-item-main">${escapeHtmlSearch(c.nome)}</div>
            <div class="search-palette-item-sub">${c.codigo ? 'Código ' + c.codigo : 'Plano de Contas'}</div>
          </div>
        </div>`;
    });
  }

  if (data.lancamentos.length) {
    html += `<div class="search-palette-group">Lançamentos</div>`;
    data.lancamentos.forEach(l => {
      _searchResults.push({ ...l });
      const cor = l.tipo === 'debito' ? '#dc2626' : '#16a34a';
      html += `
        <div class="search-palette-item" data-ridx="${_searchResults.length - 1}">
          <div class="search-palette-item-icon" style="background:${l.tipo === 'debito' ? '#fef2f2' : '#f0fdf4'}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="2">
              ${l.tipo === 'debito'
                ? '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'
                : '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'}
            </svg>
          </div>
          <div style="flex:1;min-width:0">
            <div class="search-palette-item-main" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtmlSearch(l.descricao || '(sem descrição)')}</div>
            <div class="search-palette-item-sub">${escapeHtmlSearch(l.contaNome)} · ${escapeHtmlSearch(l.data || '')}</div>
          </div>
          <div style="font-size:13px;font-weight:600;color:${cor};white-space:nowrap">${_fmtValor(l.valor, l.tipo)}</div>
        </div>`;
    });
  }

  if (data.fornecedores.length) {
    html += `<div class="search-palette-group">Fornecedores</div>`;
    data.fornecedores.forEach(f => {
      _searchResults.push({ ...f });
      html += `
        <div class="search-palette-item" data-ridx="${_searchResults.length - 1}">
          <div class="search-palette-item-icon" style="background:#fdf4ff">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9333ea" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div>
            <div class="search-palette-item-main">${escapeHtmlSearch(f.nome)}</div>
            <div class="search-palette-item-sub">${f.doc || (f.tipoPessoa === 'fisica' ? 'Pessoa Física' : 'Pessoa Jurídica')}</div>
          </div>
        </div>`;
    });
  }

  box.innerHTML = html;
  _searchFocusIdx = -1;

  box.querySelectorAll('.search-palette-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      box.querySelectorAll('.search-palette-item').forEach(i => i.classList.remove('focused'));
      item.classList.add('focused');
      _searchFocusIdx = +item.dataset.ridx;
    });
    item.addEventListener('click', () => _selectResult(+item.dataset.ridx));
  });
}

function _selectResult(idx) {
  const r = _searchResults[idx];
  if (!r) return;
  closeSearch();

  if (r.type === 'conta') {
    if (typeof navigateTo === 'function') navigateTo('plano');
    setTimeout(() => {
      if (typeof mostrarDetalhe === 'function') {
        const conta = repo && repo.findById(r.id);
        if (conta) mostrarDetalhe(conta);
      }
    }, 100);
  } else if (r.type === 'lancamento') {
    if (typeof navigateTo === 'function') navigateTo('plano');
    setTimeout(() => {
      const conta = repo && repo.findById(r.contaId);
      if (conta && typeof mostrarDetalhe === 'function') mostrarDetalhe(conta);
    }, 100);
  } else if (r.type === 'fornecedor') {
    if (typeof navigateTo === 'function') navigateTo('fornecedores');
  }
}

// ── Keyboard navigation ───────────────────────────────────────────────────

function _moveFocus(dir) {
  const items = document.querySelectorAll('#searchResults .search-palette-item');
  if (!items.length) return;
  items.forEach(i => i.classList.remove('focused'));
  _searchFocusIdx = Math.max(0, Math.min(items.length - 1, _searchFocusIdx + dir));
  items[_searchFocusIdx].classList.add('focused');
  items[_searchFocusIdx].scrollIntoView({ block: 'nearest' });
}

// ── Abrir / fechar ────────────────────────────────────────────────────────

function openSearch() {
  const pal = document.getElementById('searchPalette');
  if (!pal) return;
  pal.style.display = 'flex';
  _searchOpen = true;
  const inp = document.getElementById('searchPaletteInput');
  if (inp) { inp.value = ''; inp.focus(); }
  document.getElementById('searchResults').innerHTML = '';
}

function closeSearch() {
  const pal = document.getElementById('searchPalette');
  if (pal) pal.style.display = 'none';
  _searchOpen = false;
}

function escapeHtmlSearch(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Keyboard shortcut Ctrl+K / Cmd+K
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      _searchOpen ? closeSearch() : openSearch();
    }
    if (!_searchOpen) return;
    if (e.key === 'Escape') { closeSearch(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _moveFocus(1); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _moveFocus(-1); }
    if (e.key === 'Enter') {
      if (_searchFocusIdx >= 0) _selectResult(_searchFocusIdx);
    }
  });

  // Close on backdrop click
  document.getElementById('searchPalette')?.addEventListener('click', e => {
    if (e.target === document.getElementById('searchPalette')) closeSearch();
  });

  // Input handler with debounce
  const inp = document.getElementById('searchPaletteInput');
  if (inp) {
    let _t;
    inp.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => {
        const q = inp.value.trim();
        if (q.length < 2) {
          document.getElementById('searchResults').innerHTML = '';
          return;
        }
        _renderResults(_search(q));
      }, 180);
    });
  }

  // Topbar search button
  document.getElementById('btnOpenSearch')?.addEventListener('click', openSearch);
});

window.openSearch  = openSearch;
window.closeSearch = closeSearch;
