'use strict';

// ── Repositório de Fornecedores (MySQL via API, cache em memória) ─────────
const FORN_KEY = 'plano_fornecedores_v1'; // mantido só para migração

const fornRepo = (() => {
  let _cache = [];

  // ── Leituras síncronas (da cache) ──────────────────────────────────────
  function getAll()     { return _cache.filter(f => (f.status || 'ativo') !== 'excluido'); }
  function listar()     { return getAll(); }
  function findById(id) { return _cache.find(f => f.id === id) || null; }

  // ── Sincronização com o servidor ───────────────────────────────────────
  async function sincronizar() {
    try {
      const resp = await fetch(apiUrl('/api/fornecedores'), { credentials: 'include' });
      if (!resp.ok) return;
      const j = await resp.json();
      if (!j.ok) return;

      // Primeira vez: migrar dados do localStorage para o servidor
      const local = (() => { try { return JSON.parse(localStorage.getItem(FORN_KEY) || '[]'); } catch { return []; } })();
      if (j.fornecedores.length === 0 && local.length > 0) {
        if (typeof showToast === 'function') showToast('Migrando fornecedores para o banco de dados…', 'info');
        for (const f of local) {
          try {
            await fetch(apiUrl('/api/fornecedores'), {
              method: 'POST', credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(f),
            });
          } catch {}
        }
        localStorage.removeItem(FORN_KEY);
        // Recarrega após migração
        const r2 = await fetch(apiUrl('/api/fornecedores'), { credentials: 'include' });
        const j2 = await r2.json();
        _cache = j2.ok ? j2.fornecedores : local;
        if (typeof showToast === 'function') showToast(`${local.length} fornecedor(es) migrado(s) com sucesso.`, 'success');
      } else {
        _cache = j.fornecedores;
        // Limpa localStorage legado se ainda existir
        if (local.length > 0) localStorage.removeItem(FORN_KEY);
      }

      window.dispatchEvent(new Event('fornecedores:update'));
    } catch (e) {
      // Fallback offline: usa localStorage se disponível
      try { _cache = JSON.parse(localStorage.getItem(FORN_KEY) || '[]'); } catch {}
    }
  }

  // ── Criar (async — precisa do ID do servidor) ──────────────────────────
  async function create(forn) {
    const resp = await fetch(apiUrl('/api/fornecedores'), {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forn),
    });
    const j = await resp.json();
    if (!j.ok) throw new Error(j.erro || 'Erro ao salvar');
    const saved = { ...forn, id: j.id };
    _cache.push(saved);
    window.dispatchEvent(new Event('fornecedores:update'));
    return saved;
  }

  // ── Atualizar (otimista: cache imediato, API em seguida) ───────────────
  function save(forn) {
    const idx = _cache.findIndex(f => f.id === forn.id);
    if (idx >= 0) _cache[idx] = forn; else _cache.push(forn);
    window.dispatchEvent(new Event('fornecedores:update'));
    fetch(apiUrl('/api/fornecedores/' + forn.id), {
      method: 'PUT', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forn),
    }).catch(() => { if (typeof showToast === 'function') showToast('Erro ao sincronizar fornecedor.', 'error'); });
  }

  // ── Remover (otimista) ─────────────────────────────────────────────────
  function remove(id) {
    _cache = _cache.filter(f => f.id !== id);
    window.dispatchEvent(new Event('fornecedores:update'));
    fetch(apiUrl('/api/fornecedores/' + id), { method: 'DELETE', credentials: 'include' })
      .catch(() => { if (typeof showToast === 'function') showToast('Erro ao excluir fornecedor.', 'error'); });
  }

  return { getAll, listar, findById, sincronizar, create, save, remove };
})();

window.fornRepo = fornRepo;

// ── Estado da página ──────────────────────────────────────────────────────
let _fornEditandoId = null;

// ── Formatadores ──────────────────────────────────────────────────────────
function _fmtCnpj(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2)  return d;
  if (d.length <= 5)  return d.replace(/^(\d{2})(\d)/, '$1.$2');
  if (d.length <= 8)  return d.replace(/^(\d{2})(\d{3})(\d)/, '$1.$2.$3');
  if (d.length <= 12) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d)/, '$1.$2.$3/$4');
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function _fmtCpf(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3)  return d;
  if (d.length <= 6)  return d.replace(/^(\d{3})(\d)/, '$1.$2');
  if (d.length <= 9)  return d.replace(/^(\d{3})(\d{3})(\d)/, '$1.$2.$3');
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d)/, '$1.$2.$3-$4');
}

function _fmtTelefone(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2)  return d.length ? '(' + d : d;
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

function _fmtCep(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? d.slice(0,5) + '-' + d.slice(5) : d;
}

function _validarCnpj(cnpj) {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len) => {
    let s = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) {
      s += +d.charAt(len - i) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === +d[12] && calc(13) === +d[13];
}

function _validarCpf(cpf) {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += +d[i] * (len + 1 - i);
    const r = (s * 10) % 11;
    return r >= 10 ? 0 : r;
  };
  return calc(9) === +d[9] && calc(10) === +d[10];
}

// ── Toggle Tipo de Pessoa ─────────────────────────────────────────────────
function _getTipoPessoa() {
  const active = document.querySelector('#fornTipoPessoaGroup [data-tipo].active-tipo');
  return active?.dataset.tipo || 'juridica';
}

function _setTipoPessoa(tipo) {
  document.querySelectorAll('#fornTipoPessoaGroup [data-tipo]').forEach(btn => {
    const isActive = btn.dataset.tipo === tipo;
    btn.style.background  = isActive ? 'var(--c-primary)' : 'transparent';
    btn.style.color       = isActive ? '#fff' : 'var(--c-text-muted)';
    btn.classList.toggle('active-tipo', isActive);
  });

  const docInput      = document.getElementById('fornCnpj');
  const docLabel      = document.getElementById('fornDocLabel');
  const razaoLabel    = document.getElementById('fornRazaoLabel');
  const nomeFantRow   = document.getElementById('fornNomeFantasiaRow');
  const razaoInput    = document.getElementById('fornRazaoSocial');

  const pfExtraRow = document.getElementById('fornPfExtraRow');

  if (tipo === 'fisica') {
    if (docLabel)    docLabel.textContent = 'CPF';
    if (docInput)  { docInput.placeholder = '000.000.000-00'; docInput.maxLength = 14; }
    if (razaoLabel)  razaoLabel.innerHTML = 'Nome <span style="color:var(--c-saida)">*</span>';
    if (razaoInput)  razaoInput.placeholder = 'Nome completo';
    if (nomeFantRow) nomeFantRow.style.display = 'none';
    if (pfExtraRow)  pfExtraRow.style.display  = '';
  } else {
    if (docLabel)    docLabel.textContent = 'CNPJ';
    if (docInput)  { docInput.placeholder = '00.000.000/0000-00'; docInput.maxLength = 18; }
    if (razaoLabel)  razaoLabel.innerHTML = 'Razão Social <span style="color:var(--c-saida)">*</span>';
    if (razaoInput)  razaoInput.placeholder = 'Nome completo da empresa';
    if (nomeFantRow) nomeFantRow.style.display = '';
    if (pfExtraRow)  pfExtraRow.style.display  = 'none';
  }
}

// ── Buscar endereço pelo CEP (ViaCEP) ─────────────────────────────────────
async function _buscarCep(cep) {
  const d = cep.replace(/\D/g, '');
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    return j.erro ? null : j;
  } catch { return null; }
}

// ── Coletar contas folha do repo ──────────────────────────────────────────
function _coletarContasFolha() {
  const lista = [];
  if (!window.repo || !repo.root) return lista;
  function caminhar(c) {
    if (!c.hasChildren) lista.push(c);
    let ch = c.firstChild;
    while (ch) { caminhar(ch); ch = ch.nextSibling; }
  }
  let c = repo.root.firstChild;
  while (c) { caminhar(c); c = c.nextSibling; }
  return lista;
}

// ── Renderizar tabela ─────────────────────────────────────────────────────
function _renderTabela() {
  const tbody  = document.getElementById('tbodyFornecedores');
  const busca  = (document.getElementById('fornBusca')?.value || '').toLowerCase().trim();
  const status = document.getElementById('fornFiltroStatus')?.value || '';

  let lista = fornRepo.getAll();
  if (busca) lista = lista.filter(f =>
    (f.razaoSocial  || '').toLowerCase().includes(busca) ||
    (f.nomeFantasia || '').toLowerCase().includes(busca) ||
    (f.cnpj         || '').includes(busca) ||
    (f.cpf          || '').includes(busca)
  );
  if (status) lista = lista.filter(f => (f.status || 'ativo') === status);

  // Stats
  const todos    = fornRepo.getAll();
  const ativos   = todos.filter(f => (f.status || 'ativo') === 'ativo').length;
  const inativos = todos.length - ativos;
  document.getElementById('fornTotal')?.setAttribute('data-val', todos.length);
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('fornTotal',   todos.length);
  setEl('fornAtivos',  ativos);
  setEl('fornInativos', inativos);

  if (!tbody) return;

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--c-text-muted)">
      ${busca || status ? 'Nenhum fornecedor encontrado com os filtros aplicados.' : 'Nenhum fornecedor cadastrado. Clique em <strong>Novo Fornecedor</strong>.'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(f => {
    const nome    = f.nomeFantasia || f.razaoSocial || '—';
    const sub     = f.nomeFantasia ? f.razaoSocial : '';
    const cidade  = [f.cidade, f.uf].filter(Boolean).join(' / ') || '—';
    const contas  = (f.contaIds || []).length;
    const ativo   = (f.status || 'ativo') === 'ativo';
    return `
      <tr>
        <td style="font-size:12.5px;font-family:monospace;white-space:nowrap">${(f.tipoPessoa === 'fisica' ? f.cpf : f.cnpj) || '—'}</td>
        <td>
          <div style="font-weight:600;font-size:13px">${_esc(nome)}</div>
          ${sub ? `<div style="font-size:11.5px;color:var(--c-text-muted)">${_esc(sub)}</div>` : ''}
        </td>
        <td style="font-size:13px;white-space:nowrap">${_esc(f.telefone || '—')}</td>
        <td style="font-size:12.5px">${_esc(cidade)}</td>
        <td style="font-size:12.5px;color:var(--c-text-muted)">${contas > 0 ? contas + ' conta' + (contas > 1 ? 's' : '') : '<span style="color:#cbd5e1">Nenhuma</span>'}</td>
        <td>
          <span class="type-badge ${ativo ? 'entrada' : ''}" style="${!ativo ? 'background:var(--c-bg-hover);color:var(--c-text-muted)' : ''}">${ativo ? 'Ativo' : 'Inativo'}</span>
        </td>
        <td class="td-actions">
          <button class="icon-btn forn-edit-btn" data-id="${f.id}" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger forn-del-btn" data-id="${f.id}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`;
  }).join('');

  // Bind botões
  tbody.querySelectorAll('.forn-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => _abrirModal(+btn.dataset.id))
  );
  tbody.querySelectorAll('.forn-del-btn').forEach(btn =>
    btn.addEventListener('click', () => _excluirFornecedor(+btn.dataset.id))
  );
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Abrir modal ───────────────────────────────────────────────────────────
function _abrirModal(id = null) {
  _fornEditandoId = id;
  const forn  = id ? fornRepo.findById(id) : null;
  const modal = document.getElementById('modalFornecedor');
  const titulo = document.getElementById('tituloFornecedor');
  if (!modal) return;

  titulo.textContent = forn ? 'Editar Fornecedor' : 'Novo Fornecedor';

  // Tipo de pessoa
  const tipo = forn?.tipoPessoa || 'juridica';
  _setTipoPessoa(tipo);

  // Preencher campos
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('fornCnpj',           tipo === 'fisica' ? (forn?.cpf || '') : (forn?.cnpj || ''));
  set('fornStatus',         forn?.status           || 'ativo');
  set('fornRazaoSocial',    forn?.razaoSocial       || '');
  set('fornNomeFantasia',   forn?.nomeFantasia      || '');
  set('fornTelefone',       forn?.telefone          || '');
  set('fornEmail',          forn?.email             || '');
  set('fornCep',            forn?.cep               || '');
  set('fornLogradouro',     forn?.logradouro        || '');
  set('fornNumero',         forn?.numero            || '');
  set('fornComplemento',    forn?.complemento       || '');
  set('fornBairro',         forn?.bairro            || '');
  set('fornCidade',         forn?.cidade            || '');
  set('fornUf',             forn?.uf                || '');
  set('fornObs',            forn?.obs               || '');
  set('fornRg',             forn?.rg                || '');
  set('fornDataNascimento', forn?.dataNascimento    || '');
  set('fornInssPis',        forn?.inssPis           || '');
  set('fornTituloEleitor',  forn?.tituloEleitor     || '');

  // Contas vinculadas (checkboxes)
  _renderContasVinculadas(forn?.contaIds || []);

  modal.style.display = 'flex';
  if (typeof trapFocus === 'function') trapFocus(modal);
  setTimeout(() => document.getElementById('fornCnpj')?.focus(), 80);
}

function _renderContasVinculadas(selecionadas = []) {
  const container = document.getElementById('fornContasVinculadas');
  if (!container) return;
  const contas = _coletarContasFolha();
  if (contas.length === 0) {
    container.innerHTML = '<span style="color:var(--c-text-muted);font-size:13px">Nenhuma conta folha disponível no plano de contas.</span>';
    return;
  }
  container.innerHTML = contas.map(c => `
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 6px;border-radius:4px;cursor:pointer;user-select:none" title="${_esc(c.caminho)}">
      <input type="checkbox" value="${c.id}" ${selecionadas.includes(c.id) ? 'checked' : ''}
             style="accent-color:var(--c-primary);width:14px;height:14px">
      <span style="font-weight:500">${_esc(c.nome)}</span>
      <span style="color:var(--c-text-muted);font-size:11px">${_esc(c.caminho)}</span>
    </label>`
  ).join('');
}

function _fecharModal() {
  const modal = document.getElementById('modalFornecedor');
  if (modal) modal.style.display = 'none';
  _fornEditandoId = null;
}

// ── Salvar fornecedor ─────────────────────────────────────────────────────
async function _salvarFornecedor() {
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const tipo = _getTipoPessoa();

  const docRaw = g('fornCnpj').replace(/\D/g, '');

  if (tipo === 'fisica') {
    if (docRaw && docRaw.length === 11 && !_validarCpf(docRaw)) {
      if (typeof showToast === 'function') showToast('CPF inválido. Verifique o número digitado.', 'warning');
      document.getElementById('fornCnpj')?.focus();
      return;
    }
  } else {
    if (docRaw && docRaw.length === 14 && !_validarCnpj(docRaw)) {
      if (typeof showToast === 'function') showToast('CNPJ inválido. Verifique o número digitado.', 'warning');
      document.getElementById('fornCnpj')?.focus();
      return;
    }
  }

  const docFmt = tipo === 'fisica' ? _fmtCpf(docRaw) : _fmtCnpj(docRaw);

  const razao = g('fornRazaoSocial');
  if (!razao) {
    const label = tipo === 'fisica' ? 'Nome' : 'Razão Social';
    if (typeof showToast === 'function') showToast(`${label} é obrigatório.`, 'warning');
    document.getElementById('fornRazaoSocial')?.focus();
    return;
  }

  // Coletar contas vinculadas
  const contaIds = [...document.querySelectorAll('#fornContasVinculadas input[type=checkbox]:checked')]
    .map(cb => +cb.value);

  const forn = {
    id:             _fornEditandoId || undefined,
    tipoPessoa:     tipo,
    cnpj:           tipo === 'juridica' ? docFmt : '',
    cpf:            tipo === 'fisica'   ? docFmt : '',
    status:         g('fornStatus') || 'ativo',
    razaoSocial:    razao.toUpperCase(),
    nomeFantasia:   tipo === 'juridica' ? g('fornNomeFantasia').toUpperCase() : '',
    telefone:       g('fornTelefone'),
    email:          g('fornEmail').toLowerCase(),
    cep:            g('fornCep'),
    logradouro:     g('fornLogradouro').toUpperCase(),
    numero:         g('fornNumero'),
    complemento:    g('fornComplemento').toUpperCase(),
    bairro:         g('fornBairro').toUpperCase(),
    cidade:         g('fornCidade').toUpperCase(),
    uf:             g('fornUf').toUpperCase(),
    obs:            g('fornObs'),
    // Campos exclusivos PF — para recibo de autônomo
    rg:             tipo === 'fisica' ? g('fornRg')             : '',
    dataNascimento: tipo === 'fisica' ? g('fornDataNascimento') : '',
    inssPis:        tipo === 'fisica' ? g('fornInssPis')        : '',
    tituloEleitor:  tipo === 'fisica' ? g('fornTituloEleitor')  : '',
    contaIds,
    updatedAt:      new Date().toISOString(),
  };

  const isEdicao = !!_fornEditandoId;
  _fecharModal();

  try {
    if (isEdicao) {
      fornRepo.save(forn);
    } else {
      // remove id provisório — servidor vai atribuir
      delete forn.id;
      await fornRepo.create(forn);
    }
    _renderTabela();
    const msg = isEdicao ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado com sucesso!';
    if (typeof showToast === 'function') showToast(msg, 'success');
  } catch(e) {
    if (typeof showToast === 'function') showToast('Erro ao salvar fornecedor: ' + (e.message || ''), 'error');
    _renderTabela();
  }
}

// ── Excluir fornecedor ────────────────────────────────────────────────────
function _excluirFornecedor(id) {
  const forn = fornRepo.findById(id);
  if (!forn) return;
  if (typeof confirmar === 'function') {
    confirmar(
      'Excluir Fornecedor',
      `Excluir "${forn.nomeFantasia || forn.razaoSocial}"? Esta ação não pode ser desfeita.`,
      () => {
        fornRepo.remove(id);
        _renderTabela();
        if (typeof showToast === 'function') showToast('Fornecedor excluído.', 'info');
        try { window.dispatchEvent(new Event('fornecedores:update')); } catch(e) {}
      },
      { confirmLabel: 'Excluir', confirmClass: 'btn-danger' }
    );
  } else {
    if (confirm(`Excluir "${forn.nomeFantasia || forn.razaoSocial}"?`)) {
      fornRepo.remove(id);
      _renderTabela();
    }
  }
}

// ── Exportar CSV ──────────────────────────────────────────────────────────
function _exportarCSV() {
  const lista = fornRepo.getAll();
  if (!lista.length) { if (typeof showToast === 'function') showToast('Nenhum fornecedor para exportar.', 'warning'); return; }
  const header = ['ID','Tipo','CNPJ','CPF','Razão Social','Nome Fantasia','Telefone','Email','CEP','Logradouro','Número','Complemento','Bairro','Cidade','UF','Status','Observações'];
  const rows   = lista.map(f => [
    f.id, f.tipoPessoa || 'juridica', f.cnpj, f.cpf, f.razaoSocial, f.nomeFantasia,
    f.telefone, f.email, f.cep, f.logradouro, f.numero, f.complemento, f.bairro,
    f.cidade, f.uf, f.status, f.obs
  ].map(v => `"${String(v || '').replace(/"/g,'""')}"`));
  const csv  = [header, ...rows].map(r => r.join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url;
  a.download = `fornecedores_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Expor função para o modal de lançamento ───────────────────────────────
/**
 * Retorna fornecedores vinculados a uma conta pelo id da conta.
 * Usado por tree.js para popular o select no modal de lançamento.
 */
window.getFornecedoresDaConta = function(contaId) {
  return fornRepo.getAll().filter(f => {
    if ((f.status || 'ativo') !== 'ativo') return false;
    const linked = f.contaIds || [];
    return linked.length === 0 || linked.includes(contaId);
  });
};

// ── Init da view ──────────────────────────────────────────────────────────
function refreshFornecedoresView() {
  fornRepo.sincronizar().then(() => _renderTabela());
}

// ── Bind eventos ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Abrir modal novo
  document.getElementById('btnNovoFornecedor')?.addEventListener('click', () => _abrirModal());

  // Fechar modal
  document.getElementById('btnFecharFornecedor')?.addEventListener('click', _fecharModal);
  document.getElementById('btnCancelarFornecedor')?.addEventListener('click', _fecharModal);
  document.getElementById('modalFornecedor')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modalFornecedor')) _fecharModal();
  });

  // Confirmar salvar
  document.getElementById('btnConfirmarFornecedor')?.addEventListener('click', _salvarFornecedor);

  // Exportar
  document.getElementById('btnFornExportCSV')?.addEventListener('click', _exportarCSV);

  // Busca / filtro em tempo real
  document.getElementById('fornBusca')?.addEventListener('input', _renderTabela);
  document.getElementById('fornFiltroStatus')?.addEventListener('change', _renderTabela);

  // Toggle Tipo de Pessoa
  document.querySelectorAll('#fornTipoPessoaGroup [data-tipo]').forEach(btn => {
    btn.addEventListener('click', () => {
      _setTipoPessoa(btn.dataset.tipo);
      const docInput = document.getElementById('fornCnpj');
      if (docInput) docInput.value = '';
    });
  });

  // Máscara CNPJ / CPF (dinâmica conforme tipo selecionado)
  document.getElementById('fornCnpj')?.addEventListener('input', function() {
    const pos = this.selectionStart;
    this.value = _getTipoPessoa() === 'fisica' ? _fmtCpf(this.value) : _fmtCnpj(this.value);
    try { this.setSelectionRange(pos, pos); } catch(e) {}
  });

  // Máscara telefone
  document.getElementById('fornTelefone')?.addEventListener('input', function() {
    this.value = _fmtTelefone(this.value);
  });

  // Máscara CEP + busca automática
  const cepInput = document.getElementById('fornCep');
  if (cepInput) {
    cepInput.addEventListener('input', function() {
      this.value = _fmtCep(this.value);
    });
    cepInput.addEventListener('blur', async function() {
      const cep = this.value.replace(/\D/g, '');
      if (cep.length !== 8) return;
      const dados = await _buscarCep(cep);
      if (dados) {
        const s = id => document.getElementById(id);
        if (s('fornLogradouro') && !s('fornLogradouro').value) s('fornLogradouro').value = dados.logradouro || '';
        if (s('fornBairro')    && !s('fornBairro').value)     s('fornBairro').value    = dados.bairro    || '';
        if (s('fornCidade')    && !s('fornCidade').value)     s('fornCidade').value    = dados.localidade || '';
        if (s('fornUf')        && !s('fornUf').value)         s('fornUf').value        = dados.uf        || '';
        if (typeof showToast === 'function') showToast('Endereço preenchido via CEP.', 'success');
        s('fornNumero')?.focus();
      } else if (typeof showToast === 'function') {
        showToast('CEP não encontrado.', 'warning');
      }
    });
  }

  // Render inicial
  _renderTabela();
});

// Expor globalmente
window.refreshFornecedoresView = refreshFornecedoresView;
