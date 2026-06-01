/**
 * tree.js — Renderização da árvore interativa de contas
 * Funcionalidades: seleção, expansão, drag-drop, add, remove, rename (dblclick)
 * Melhorias: código hierárquico, busca em tempo real, atalhos de teclado
 */

/** Utilitário de escape HTML para prevenir XSS em innerHTML */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

'use strict';

// Helper para montar URL da API corretamente mesmo quando aberto como file://
function apiUrl(path) {
  const base = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE
    : ((location && location.protocol === 'file:') ? 'http://localhost:3000' : '');
  return base + path;
}

/**
 * Logger condicional — só emite em modo desenvolvimento.
 * Em produção defina window.APP_ENV = 'production' (via index.html ou build)
 * para silenciar completamente sem alterar código.
 */
const _DEV = (typeof window !== 'undefined') && window.APP_ENV !== 'production';
const log = {
  debug : (...a) => { if (_DEV) console.log(...a); },  // detalhes internos
  warn  : (...a) => console.warn(...a),                    // sempre visível
  error : (...a) => console.error(...a),                   // sempre visível
};

// ── Guard de permissão seguro (caso auth ainda não esteja carregado) ──────
function authCan(acao) {
  try { return typeof auth !== 'undefined' ? auth.can(acao) : true; } catch { return true; }
}

// ── Estado da árvore ───────────────────────────────────────────────────────
const treeState = {
  selectedId:   null,
  expanded:     new Set(),
  dragSourceId: null,
  searchQuery:  ''
};

// filtro de visualização: obsoleto — sempre mostramos todas as contas
// por padrão mostrar SAIDAS (comportamento herdado)
// por padrão mostrar SAIDAS (comportamento herdado)
treeState.showOnly = 'saidas';
// Quando showOnly for 'entradas' ou 'saidas' guardamos o root correspondente (por id)
treeState.viewRootId = null;

// ── Referências DOM ────────────────────────────────────────────────────────
const treeRoot            = document.getElementById('treeRoot');
const btnAddParent        = document.getElementById('btnAddParent');
const btnNovo             = document.getElementById('btnNovo');
const btnRenomear         = document.getElementById('btnRenomear');
const btnRemover          = document.getElementById('btnRemover');

const selectedParentDisp  = document.getElementById('selectedParentDisplay');
const badgeTotal          = document.getElementById('badgeTotal');
const inputBusca          = document.getElementById('inputBuscaConta');
const btnLimparBusca      = document.getElementById('btnLimparBusca');

// Detail panel
const welcomeState  = document.getElementById('welcomeState');
const contaDetail   = document.getElementById('contaDetail');
const detailIcon    = document.getElementById('detailIcon');
const detailNome    = document.getElementById('detailNome');
const detailCaminho = document.getElementById('detailCaminho');

// Modal renomear
const modalRenomear      = document.getElementById('modalRenomear');
const inputRenomear      = document.getElementById('inputRenomear');
const btnConfirmarRenomear = document.getElementById('btnConfirmarRenomear');
const btnCancelarRenomear  = document.getElementById('btnCancelarRenomear');
const btnFecharRenomear    = document.getElementById('btnFecharRenomear');

// Exportar XML
const btnExportXML = document.getElementById('btnExportXML');

// ── Animação de expand/collapse ────────────────────────────────────────────
function animarExpand(ul, expandir) {
  // Usa max-height para animação suave
  if (expandir) {
    ul.style.display = '';
    const h = ul.scrollHeight;
    ul.style.maxHeight = '0';
    ul.style.overflow  = 'hidden';
    ul.style.transition = 'max-height .22s ease';
    requestAnimationFrame(() => { ul.style.maxHeight = h + 'px'; });
    ul.addEventListener('transitionend', () => {
      ul.style.maxHeight = '';
      ul.style.overflow  = '';
      ul.style.transition = '';
    }, { once: true });
    // no early return here; rendering of launches continues below
  }
  else {
    // animação de recolher: fixa a altura atual e transita para 0, depois esconde
    try {
      const h = ul.scrollHeight;
      ul.style.maxHeight = h + 'px';
      ul.style.overflow = 'hidden';
      ul.style.transition = 'max-height .22s ease';
      requestAnimationFrame(() => { ul.style.maxHeight = '0'; });
      ul.addEventListener('transitionend', () => {
        ul.style.display = 'none';
        ul.style.maxHeight = '';
        ul.style.overflow = '';
        ul.style.transition = '';
      }, { once: true });
    } catch(e) { try { ul.style.display = 'none'; } catch(_) {} }
  }
}
function iconLeaf() {
  return `<svg class="node-icon" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="4" fill="#e2e8f0"/></svg>`;
}

function iconToggle() {
  return `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,2 8,5 2,8"/></svg>`;
}

// Ícone de pasta (aberta/fechada) — retorna SVG inline
function iconFolder(isOpen) {
  // usar cores semelhantes ao ícone folha para manter consistência visual
  if (isOpen) {
    return `<svg class="node-icon" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.6"><path d="M3 7a2 2 0 012-2h4l2 3h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#e2e8f0"/></svg>`;
  }
  return `<svg class="node-icon" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.6"><path d="M3 7a2 2 0 012-2h4l2 3h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#e2e8f0"/></svg>`;
}

// ── Renderização ───────────────────────────────────────────────────────────
function renderTree() {
  treeRoot.innerHTML = '';
  const q = treeState.searchQuery.toLowerCase().trim();

  if (q) {
    if (repo.root) {
      const roots = getRootChildrenFlattened();
      for (const c of roots) renderModoFiltro(c, treeRoot, q);
    }
  } else {
    if (repo.root) {
      const roots = getRootChildrenFlattened();
      for (const c of roots) renderNode(c, treeRoot, false);
    }
  }
  updateBadge();
}

// Retorna os filhos de primeiro nível do PLANO, mas 'achata' nós legados ENTRADAS/SAIDAS
function getRootChildrenFlattened() {
  const arr = [];
  if (!repo || !repo.root) return arr;
  // Quando showOnly for 'entradas' ou 'saidas' tentamos usar viewRootId (mais robusto)
  if (treeState.showOnly === 'entradas' || treeState.showOnly === 'saidas') {
    if (treeState.viewRootId) {
      const root = repo.findById(treeState.viewRootId);
      if (root) {
        let c = root.firstChild;
        while (c) { arr.push(c); c = c.nextSibling; }
        return arr;
      }
    }
    // fallback por nome
    let r = repo.root.firstChild;
    while (r) {
      const name = (r.nome || '').toUpperCase();
      if ((treeState.showOnly === 'entradas' && name.includes('ENTRAD')) ||
          (treeState.showOnly === 'saidas' && name.includes('SAID'))) {
        let c = r.firstChild;
        while (c) { arr.push(c); c = c.nextSibling; }
        return arr;
      }
      r = r.nextSibling;
    }
    // se não encontrar, continua para retornar todos
  }

  let r = repo.root.firstChild;
  while (r) { arr.push(r); r = r.nextSibling; }
  return arr;
}

/** Verifica se conta ou algum descendente casa com a query */
function contaCasaBusca(conta, q) {
  if (conta.nome.toLowerCase().includes(q)) return true;
  if (conta.codigo.includes(q)) return true;
  let c = conta.firstChild;
  while (c) { if (contaCasaBusca(c, q)) return true; c = c.nextSibling; }
  return false;
}

// Retorna o ancestral de primeiro nível (filho direto do root) para uma conta
function getFirstLevelAncestor(conta) {
  if (!conta || !repo || !repo.root) return null;
  let c = conta;
  while (c && c.parent && !c.parent.isRoot) c = c.parent;
  // agora c.parent é root ou c é root
  if (c && c.parent && c.parent.isRoot) return c;
  return null;
}

function renderModoFiltro(conta, parentUL, q) {
  if (!contaCasaBusca(conta, q)) return;
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.id = conta.id;

  const row = document.createElement('div');
  const isSelected = treeState.selectedId === conta.id;
  const match = conta.nome.toLowerCase().includes(q) || conta.codigo.includes(q);
  row.className = 'tree-node-row'
    + (isSelected ? ' selected' : '')
    + (match && !conta.isRoot ? ' search-match' : '');
  // marcar nós que SÃO o primeiro nível (filhos diretos do root ou o próprio filho de ENTRADAS/SAIDAS)
  const firstAncestor = getFirstLevelAncestor(conta);
  if (firstAncestor && firstAncestor.id === conta.id) {
    row.className += ' root-node';
    const an = (firstAncestor.nome || '').toUpperCase();
    if (an.includes('ENTRAD')) row.className += ' root-entrada';
    else if (an.includes('SAID')) row.className += ' root-saida';
  }
  row.dataset.id = conta.id;

  const label = document.createElement('span');
  label.className = 'node-label';
  label.innerHTML = match && !conta.isRoot
    ? highlightTexto(conta.nome, q)
    : escapeHtml(conta.nome);

  row.appendChild(label);
  row.addEventListener('click', () => selectConta(conta.id));
  li.appendChild(row);

  if (conta.hasChildren) {
    const childUL = document.createElement('ul');
    childUL.className = 'tree-children';
    let c = conta.firstChild;
    while (c) { renderModoFiltro(c, childUL, q); c = c.nextSibling; }
    li.appendChild(childUL);
  }
  parentUL.appendChild(li);
}

function highlightTexto(texto, q) {
  const safe = escapeHtml(texto);
  const safeQ = escapeHtml(q);
  const idx = safe.toLowerCase().indexOf(safeQ.toLowerCase());
  if (idx === -1) return safe;
  return safe.slice(0, idx)
    + `<mark style="background:#fef08a;border-radius:2px;padding:0 1px">${safe.slice(idx, idx + safeQ.length)}</mark>`
    + safe.slice(idx + safeQ.length);
}

function renderNode(conta, parentUL, isRootLevel = false) {
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.id = conta.id;

  const isExpanded = treeState.expanded.has(conta.id) || isRootLevel;
  const isSelected = treeState.selectedId === conta.id;
  const isRoot     = conta.isRoot;
  // Considerar como 'container' visual (pasta) contas que têm filhos
  // ou que pertencem à hierarquia de primeiro nível (descendentes de ENTRADAS/SAIDAS).
  // Isso garante que um novo grupo (sem filhos) criado sob ENTRADAS/SAIDAS
  // apareça como pasta com toggle.
  const isContainer = conta.hasChildren || (getFirstLevelAncestor(conta) !== null);

  // Row
  const row = document.createElement('div');
  row.className = 'tree-node-row' +
  (isSelected ? ' selected' : '') + (isContainer ? ' has-children' : '');
  // marca visual para nós de primeiro nível (filhas diretas do root ou descendentes de ENTRADAS/SAIDAS)
  const firstAncestor2 = getFirstLevelAncestor(conta);
  if (firstAncestor2 && firstAncestor2.id === conta.id) {
    row.className += ' root-node';
    const an2 = (firstAncestor2.nome || '').toUpperCase();
    if (an2.includes('ENTRAD')) row.className += ' root-entrada';
    else if (an2.includes('SAID')) row.className += ' root-saida';
  }
  row.draggable = true;
  row.dataset.id = conta.id;

  // Toggle btn
  const toggle = document.createElement('button');
  // Mostrar botão de toggle como 'leaf' quando não há filhos reais.
  toggle.className = 'toggle-btn' + (conta.hasChildren ? (isExpanded ? ' expanded' : '') : ' leaf');
  // Ocultar a setinha para nós de primeiro nível (filhos diretos do root),
  // queremos que ENTRADAS/SAIDAS apareçam sem toggle visível.
  if (conta.parent && conta.parent.isRoot) {
    toggle.className = 'toggle-btn leaf';
  }
  toggle.innerHTML = iconToggle();
  toggle.tabIndex = -1;

  // Código contábil
  const codigoEl = document.createElement('span');
  codigoEl.className = 'node-codigo';
  codigoEl.textContent = conta.codigo;

  // Icon
  const iconEl = document.createElement('span');
  iconEl.innerHTML = isContainer ? iconFolder(isExpanded) : iconLeaf();

  // Label
  const label = document.createElement('span');
  label.className = 'node-label';
  label.textContent = conta.nome;

  row.appendChild(toggle);
  row.appendChild(iconEl);
  row.appendChild(label);
  li.appendChild(row);

  // Children container
  let childrenUL = null;
  // Criar o container de filhos sempre que for um 'container' visual
  if (isContainer) {
    childrenUL = document.createElement('ul');
    // usar classe que habilita transições suaves de colapso
    childrenUL.className = 'tree-children tree-collapsible';
    // quando fechado, deixar max-height:0 para que a transição funcione
    if (isExpanded) {
      childrenUL.style.display = '';
      childrenUL.style.maxHeight = '';
    } else {
      childrenUL.style.display = 'none';
      childrenUL.style.maxHeight = '0';
    }
    li.appendChild(childrenUL);

    // Renderiza filhos apenas se existirem; caso contrário fica vazio
    let c = conta.firstChild;
    while (c) {
      renderNode(c, childrenUL);
      c = c.nextSibling;
    }
  }

  // ── Eventos ──
  // Toggle expand/collapse
  toggle.addEventListener('click', (e) => {
  e.stopPropagation();
  // permitir toggle para containers visuais mesmo que não tenham filhos
  if (!isContainer) return;
  const isCurrentlyOpen = childrenUL.style.display !== 'none';
  const willOpen = !isCurrentlyOpen;

  // Atualiza estado visual imediato (icone e classe) para feedback instantâneo
  toggle.classList.toggle('expanded', willOpen);
  // Mantém ícone de pasta para containers visuais (filhos diretos do PLANO)
  iconEl.innerHTML = isContainer ? iconFolder(willOpen) : iconLeaf();

    // Ajustes prévios para garantir que a animação de max-height funcione
    if (willOpen) {
      childrenUL.style.display = '';
      // forçar cálculo de scrollHeight
      childrenUL.style.maxHeight = '0';
    }
    // Inicia animação e sincroniza o estado expandido ao final da transição
    animarExpand(childrenUL, willOpen);

    const onEnd = () => {
      try {
        if (willOpen) treeState.expanded.add(conta.id);
        else treeState.expanded.delete(conta.id);
      } catch(e){}
  // garante que o ícone reflita o estado final (em casos de interrupção)
  try { iconEl.innerHTML = isContainer ? iconFolder(willOpen) : iconLeaf(); } catch(e){}
      childrenUL.removeEventListener('transitionend', onEnd);
    };
    childrenUL.addEventListener('transitionend', onEnd, { once: true });
  });

  // Selecionar conta
  row.addEventListener('click', (e) => {
    if (e.target === toggle) return;
    selectConta(conta.id);
  });

  // Duplo clique = renomear inline
  row.addEventListener('dblclick', (e) => {
    if (isRoot) return;
    if (!authCan('renameConta')) {
      showToast('Sem permissão para renomear contas.', 'warning'); return;
    }
    e.stopPropagation();
    iniciarRenomearInline(label, conta);
  });

  // Drag & drop
  row.addEventListener('dragstart', (e) => {
    if (isRoot) { e.preventDefault(); return; }
    if (!authCan('moveConta')) { e.preventDefault(); return; }
    treeState.dragSourceId = conta.id;
    row.classList.add('drag-source');
    e.dataTransfer.effectAllowed = 'move';
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('drag-source');
    treeState.dragSourceId = null;
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!treeState.dragSourceId || treeState.dragSourceId === conta.id) return;
    const rect = row.getBoundingClientRect();
    const pct  = (e.clientY - rect.top) / rect.height;
    row.classList.remove('drag-over', 'drop-before', 'drop-after');
    if (pct < 0.30) {
      row.classList.add('drop-before');
      treeState.dropPosition = 'before';
    } else if (pct > 0.70) {
      row.classList.add('drop-after');
      treeState.dropPosition = 'after';
    } else {
      row.classList.add('drag-over');
      treeState.dropPosition = 'inside';
    }
    e.dataTransfer.dropEffect = 'move';
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('drag-over', 'drop-before', 'drop-after');
  });

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over', 'drop-before', 'drop-after');
    const srcId = treeState.dragSourceId;
    if (!srcId || srcId === conta.id) return;
    moverConta(srcId, conta.id, treeState.dropPosition || 'inside');
  });

  parentUL.appendChild(li);
}

// ── Selecionar conta ───────────────────────────────────────────────────────
function selectConta(id) {
  const mudouConta = treeState.selectedId !== id;
  treeState.selectedId = id;
  const conta = repo.findById(id);

  // Resetar filtros ao trocar de conta
  if (mudouConta) resetarFiltrosLanc();

  // Atualiza UI dos botões
  const isRoot = conta?.isRoot;
  btnRenomear.disabled = !conta || isRoot || !authCan('renameConta');
  btnRemover.disabled  = !conta || isRoot || !authCan('removeConta');

  // Atualiza painel de seleção (se o elemento existir)
  if (conta && selectedParentDisp) {
    selectedParentDisp.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
      </svg>
      ${escapeHtml(conta.nome)}`;
    selectedParentDisp.className = 'selected-parent-display has-selection';
  }

  // Marca visualmente
  document.querySelectorAll('.tree-node-row.selected').forEach(el => el.classList.remove('selected'));
  const row = document.querySelector(`.tree-node-row[data-id="${id}"]`);
  if (row) row.classList.add('selected');

  // Painel de detalhes
  try { mostrarDetalhe(conta); } catch (e) { console.error('erro em mostrarDetalhe', e); }
}

// Helper: seleciona a conta a partir da linha destacada na árvore (útil no console)
function selectContaFromHighlightedRow() {
  const row = document.querySelector('.tree-node-row.selected');
  if (!row) return null;
  const id = +row.dataset.id;
  selectConta(id);
  return id;
}

function mostrarDetalhe(conta) {
  log.debug('mostrarDetalhe start for conta', conta ? conta.id : null);
  if (!conta) {
    welcomeState.style.display = '';
    contaDetail.style.display  = 'none';
    return;
  }
  // Resetar paginação ao trocar de conta
  _lancPage = 1;
  welcomeState.style.display = 'none';
  contaDetail.style.display  = 'flex';

  detailIcon.textContent = conta.nome[0];
  detailIcon.className   = 'detail-icon ' + (conta.tipo === 'Entrada' ? 'entrada' : conta.tipo === 'Saída' ? 'saida' : '');
  detailNome.textContent    = conta.nome;
  detailCaminho.textContent = conta.caminho;

  // ── Orçamento (editável) ───────────────────────────────────────────────
  const statOrc = document.getElementById('statOrcamento');
  if (statOrc) {
    // Para contas do tipo Saída, o orçamento também é conceitualmente negativo;
    // exibimos sem sinal e em cor azul para diferenciar do saldo realizado.
    if (conta.tipo === 'Saída') {
      statOrc.innerHTML = `
        <span class="stat-label">Orçamento</span>
        <span class="stat-value" style="font-size:16px;cursor:pointer;color:var(--color-primary-h)" title="Clique para editar o orçamento"
              id="orcValorDisplay">${conta.orcamento > 0 ? formatMoeda(Math.abs(conta.orcamento)) : '—'}</span>`;
    } else {
      statOrc.innerHTML = `
        <span class="stat-label">Orçamento</span>
        <span class="stat-value" style="font-size:16px;cursor:pointer" title="Clique para editar o orçamento"
              id="orcValorDisplay">${conta.orcamento > 0 ? formatMoeda(conta.orcamento) : '—'}</span>`;
    }
    document.getElementById('orcValorDisplay').addEventListener('click', () => editarOrcamento(conta));
  }

  // ── Saldo realizado ────────────────────────────────────────────────────
  const saldo      = repo.saldoAcumulado(conta);
  const saldoEl    = document.getElementById('statSaldoValor');
  if (saldoEl) {
    // Se a conta for do tipo Saída, o saldo é sempre tratado como negativo por natureza;
    // mostramos o valor sem sinal, mas mantendo a cor vermelha para indicar saída.
    if (conta.tipo === 'Saída') {
      saldoEl.textContent = formatMoeda(Math.abs(saldo));
      saldoEl.style.color = '#dc2626';
    } else {
      const cor = saldo >= 0 ? '#16a34a' : '#dc2626';
      saldoEl.textContent = (saldo >= 0 ? '' : '−') + formatMoeda(Math.abs(saldo));
      saldoEl.style.color = cor;
    }
  }
  // notify global listeners (header balance) that saldo changed
  try { window.dispatchEvent(new Event('saldo:update')); } catch(e){}

  // ── Barra de progresso do orçamento ──────────────────────────────────
  const wrap   = document.getElementById('orcProgressWrap');
  const fill   = document.getElementById('orcProgressFill');
  const pctEl  = document.getElementById('orcProgressPct');
  const labelEl= document.getElementById('orcProgressLabel');
  const banner = document.getElementById('orcAlertaBanner');
  const alertaTexto = document.getElementById('orcAlertaTexto');

  const pct    = repo.percentualOrcamento(conta);
  const alerta = repo.alertaOrcamento(conta);
  const realizado = repo.realizadoOrcamento(conta);

  if (pct !== null && wrap) {
    wrap.style.display = '';
    const pctClamp = Math.min(pct, 100);
    fill.style.width = `${pctClamp}%`;
    fill.className = `orc-progress-fill ${alerta}`;
    pctEl.textContent  = `${pct.toFixed(1)}%`;
    pctEl.className    = `orc-progress-pct ${alerta}`;
    // Ajustar exibição para contas de Saída: mostrar valores sem sinal e com cores
    if (conta.tipo === 'Saída') {
      labelEl.innerHTML = `Realizado: <span style="color:#dc2626">${formatMoeda(Math.abs(realizado))}</span> de <span style="color:var(--color-primary-h)">${conta.orcamento>0?formatMoeda(Math.abs(conta.orcamento)):'—'}</span>`;
    } else {
      labelEl.textContent= `Realizado: ${formatMoeda(realizado)} de ${formatMoeda(conta.orcamento)}`;
    }
  } else if (wrap) {
    wrap.style.display = 'none';
  }

  if (banner) {
    if (alerta === 'excedido') {
      banner.className = 'orc-alerta excedido';
      banner.style.display = '';
      const excesso = realizado - conta.orcamento;
      alertaTexto.textContent = `Limite excedido em ${formatMoeda(excesso)} (${pct.toFixed(1)}% do orçamento)`;
    } else if (alerta === 'atencao') {
      banner.className = 'orc-alerta atencao';
      banner.style.display = '';
      alertaTexto.textContent = `Atenção: ${pct.toFixed(1)}% do orçamento utilizado — próximo do limite!`;
    } else {
      banner.style.display = 'none';
    }
  }

  // ── Botão Novo Lançamento ─────────────────────────────────────────────
  const btnNovoLanc = document.getElementById('btnNovoLancamento');
  if (btnNovoLanc) {
    // Permite lançar APENAS em contas folha (sem filhos) e quando o usuário
    // tem permissão 'newLancamento'. Para nós, contas raiz (ENTRADAS/SAIDAS)
    // e contas com subcontas não devem permitir novo lançamento.
    const temPermissao = authCan('newLancamento');
    const ehFolha = !!conta && !conta.hasChildren;
    const podeLanc = temPermissao && ehFolha;
    btnNovoLanc.disabled = !podeLanc;
    if (!temPermissao) {
      btnNovoLanc.title = 'Sem permissão para lançamentos';
      btnNovoLanc.onclick = null;
    } else if (!conta) {
      btnNovoLanc.title = 'Selecione uma conta para lançar';
      btnNovoLanc.onclick = null;
    } else if (!ehFolha) {
      btnNovoLanc.title = 'Novo lançamento somente em contas sem subcontas';
      btnNovoLanc.onclick = null;
    } else {
      btnNovoLanc.title = 'Inserir crédito ou débito nesta conta';
      btnNovoLanc.onclick = () => abrirModalLancamento(conta);
    }
  }

  // ── Resumo do mês atual ───────────────────────────────────────────────
  try { _renderMesAtual(conta); } catch(e) {}

  // ── Lista de lançamentos ──────────────────────────────────────────────
  renderLancamentos(conta);
}

// Inicializar botões de filtro (se existirem) — handlers simples
// Ao carregar, renderizar toda a árvore (sem filtros por ENTRADAS/SAIDAS)
try { renderTree(); } catch(e) { log.warn('erro ao renderizar árvore inicial', e); }

// Quando o usuário inicia uma busca ou limpa, resetar o filtro para preservar UX esperada
if (inputBusca) inputBusca.addEventListener('input', () => { treeState.searchQuery = inputBusca.value || ''; renderTree(); });
if (btnLimparBusca) btnLimparBusca.addEventListener('click', () => { inputBusca.value = ''; treeState.searchQuery = ''; renderTree(); });


/** Editar orçamento inline no painel de detalhes */
function editarOrcamento(conta) {
  if (window._authCanOrcamento === false) {
    showToast('Sem permissão para editar orçamento.', 'warning'); return;
  }

  async function _persistirOrcamento(c, valor) {
    c.orcamento = valor;
    repo.salvar();
    mostrarDetalhe(c);
    renderTree();
    showToast(`Orçamento de "${c.nome}" atualizado: ${formatMoeda(valor)}`, 'info');
    if (c.codigo_banco) {
      try {
        const resp = await fetch(apiUrl('/api/contas/' + encodeURIComponent(c.codigo_banco)), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orcamento: valor })
        });
        const j = await resp.json();
        if (!j.ok) showToast('Erro ao salvar orçamento no banco: ' + (j.erro || 'falha'), 'error');
      } catch(e) { showToast('Sem conexão com o servidor ao salvar orçamento.', 'error'); }
    }
  }

  if (conta.hasChildren) {
    const atualPai = conta.orcamento || 0;
    const atual = prompt(`Orçamento para "${conta.nome}" (R$):`, atualPai || '');
    if (atual === null) return;
    const valor = parseFloat(atual.replace(',', '.'));
    if (isNaN(valor) || valor < 0) { showToast('Valor inválido.', 'warning'); return; }

    let somaFilhas = 0;
    let ch = conta.firstChild;
    while (ch) { somaFilhas += Number(ch.orcamento || 0); ch = ch.nextSibling; }
    if (somaFilhas > valor) {
      showToast(`A soma dos orçamentos das subcontas (${formatMoeda(somaFilhas)}) excede o novo orçamento do pai (${formatMoeda(valor)}). Ajuste as subcontas primeiro.`, 'error');
      return;
    }
    _persistirOrcamento(conta, valor);
    return;
  }

  const atual = prompt(`Orçamento para "${conta.nome}" (R$):`, conta.orcamento || '');
  if (atual === null) return;
  const valor = parseFloat(atual.replace(',', '.'));
  if (isNaN(valor) || valor < 0) { showToast('Valor inválido.', 'warning'); return; }

  const parent = conta.parent;
  if (parent) {
    let soma = 0;
    let c = parent.firstChild;
    while (c) {
      if (c.id === conta.id) soma += valor;
      else soma += Number(c.orcamento || 0);
      c = c.nextSibling;
    }
    if (Number(parent.orcamento || 0) > 0 && soma > parent.orcamento) {
      showToast(`A soma dos orçamentos das subcontas (${formatMoeda(soma)}) excede o orçamento do pai (${formatMoeda(parent.orcamento)}). Ajuste o valor.`, 'error');
      return;
    }
  }

  _persistirOrcamento(conta, valor);
}

// ── Resumo do mês atual ────────────────────────────────────────────────────
function _renderMesAtual(conta) {
  const card = document.getElementById('mesAtualCard');
  if (!card) return;

  const hoje    = new Date();
  const anoMes  = hoje.toISOString().slice(0, 7); // 'YYYY-MM'
  const nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const todosLancs = coletarContas(conta).flatMap(c => c.lancamentos || []);
  const lancsMes   = todosLancs.filter(l => l.data && l.data.startsWith(anoMes));

  if (!lancsMes.length) { card.style.display = 'none'; return; }

  const entradas = lancsMes.filter(l => l.tipo === 'credito').reduce((s, l) => s + l.valor, 0);
  const saidas   = lancsMes.filter(l => l.tipo === 'debito').reduce((s, l) => s + l.valor, 0);
  const saldo    = entradas - saidas;
  const count    = lancsMes.length;

  const corSaldo = saldo >= 0 ? '#16a34a' : '#dc2626';
  const isSaida  = conta.tipo === 'Saída';

  // Para contas de saída, o relevante é só o total debitado
  const valorPrincipal = isSaida ? saidas : Math.abs(saldo);
  const corPrincipal   = isSaida ? '#dc2626' : corSaldo;
  const labelPrincipal = isSaida ? 'Gasto no mês' : 'Saldo do mês';

  // Percentual do orçamento mensal (se orçamento for anual, divide por 12)
  let pctHtml = '';
  if (conta.orcamento > 0) {
    const orcMes = conta.orcamento / 12;
    const pct    = Math.min((isSaida ? saidas : valorPrincipal) / orcMes * 100, 999);
    const cor    = pct > 100 ? '#dc2626' : pct > 80 ? '#f59e0b' : '#16a34a';
    pctHtml = `<span style="color:${cor};font-weight:600">${pct.toFixed(0)}% do orçamento mensal</span>`;
  }

  card.innerHTML = `
    <div class="mes-atual-card">
      <span class="mes-atual-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}
      </span>
      <span style="color:${corPrincipal};font-weight:700;font-size:14px;font-variant-numeric:tabular-nums">${formatMoeda(valorPrincipal)}</span>
      <span style="color:var(--c-text-muted);font-size:12px">${count} lançamento${count !== 1 ? 's' : ''}</span>
      ${entradas > 0 && saidas > 0 ? `<span style="color:var(--c-text-muted);font-size:12px">C&nbsp;${formatMoeda(entradas)} / D&nbsp;${formatMoeda(saidas)}</span>` : ''}
      ${pctHtml}
    </div>`;
  card.style.display = '';
}

// ── Renderizar lista de lançamentos no painel ──────────────────────────────
// ── Estado dos filtros de lançamentos ─────────────────────────────────────
const lancFiltro = {
  tipo:   'todos',   // 'todos' | 'credito' | 'debito'
  dtI:    '',        // ISO date string ou ''
  dtF:    '',
  busca:  '',
  ordem:  'data-desc'
};

/** Tamanho de página da lista de lançamentos (itens visíveis por vez) */
const LANC_PAGE_SIZE = (window.UI_CONFIG && window.UI_CONFIG.LANC_PAGE_SIZE) ? Number(window.UI_CONFIG.LANC_PAGE_SIZE) : 50;
/** Página atual — incrementa ao clicar em "Carregar mais", reseta ao trocar conta/filtro */
let _lancPage = 1;

function resetarFiltrosLanc() {
  lancFiltro.dtI   = '';
  lancFiltro.dtF   = '';
  lancFiltro.busca = '';
  lancFiltro.ordem = 'data-desc';
  _lancPage = 1;

  const el = id => document.getElementById(id);
  if (el('lancFiltroDtI'))   el('lancFiltroDtI').value   = '';
  if (el('lancFiltroDtF'))   el('lancFiltroDtF').value   = '';
  if (el('lancFiltroBusca')) el('lancFiltroBusca').value = '';
  if (el('lancFiltroOrdem')) el('lancFiltroOrdem').value = 'data-desc';
  _atualizarBadgeFiltros();
}

// Atualiza o badge de filtros ativos no header e a visibilidade do botão limpar.
function _atualizarBadgeFiltros() {
  let n = 0;
  if (lancFiltro.dtI || lancFiltro.dtF) n++;
  if (lancFiltro.busca && lancFiltro.busca.trim()) n++;
  const badge = document.getElementById('lancFiltroAtivoBadge');
  const btnLimpar = document.getElementById('btnLancLimparDatas');
  if (badge) {
    badge.textContent = n;
    badge.style.display = n > 0 ? '' : 'none';
  }
  if (btnLimpar) {
    btnLimpar.style.display = n > 0 ? '' : 'none';
  }
}

// Centraliza a lógica de checagem de filtros para um lançamento.
function lancPassaFiltro(l) {
  try {
    if (lancFiltro.dtI) {
      if (l.data < lancFiltro.dtI) return false;
    }
    if (lancFiltro.dtF) {
      if (l.data > lancFiltro.dtF) return false;
    }
    if (lancFiltro.busca && lancFiltro.busca.trim()) {
      const q = lancFiltro.busca.trim().toLowerCase();
      if (!(l.descricao && l.descricao.toLowerCase().includes(q))) return false;
    }
    return true;
  } catch (e) {
    // Se algo deu errado, não bloquear (retorna true para não esconder dados por falha)
    log.warn('lancPassaFiltro error, allowing by default', e);
    return true;
  }
}

// Extrai a lista filtrada/ordenada de lançamentos de uma conta (usada por renderLancamentos e exportação CSV)
function _lancamentosFiltrados(conta) {
  // Agrega lançamentos de toda a subárvore da conta selecionada (inclui a própria conta)
  const contas = coletarContas(conta);
  let lista = contas.flatMap(cc => (cc.lancamentos || []).map(l => ({ ...l, _contaId: cc.id, _contaNome: cc.nome })));
  // Usa a função centralizada para garantir que breakdown e lista concordem
  lista = lista.filter(lancPassaFiltro);
  switch (lancFiltro.ordem) {
    case 'data-asc':   lista.sort((a, b) =>  a.data.localeCompare(b.data));  break;
    case 'data-desc':  lista.sort((a, b) =>  b.data.localeCompare(a.data));  break;
    case 'valor-desc': lista.sort((a, b) => b.valor - a.valor); break;
    case 'valor-asc':  lista.sort((a, b) => a.valor - b.valor); break;
  }
  return lista;
}

// ── Breakdown helpers ────────────────────────────────────────────────────────

function _buildBreakdownHtml(conta) {
  const maxItems = (window.UI_CONFIG && window.UI_CONFIG.BREAKDOWN_MAX_ITEMS) ? Number(window.UI_CONFIG.BREAKDOWN_MAX_ITEMS) : 8;
  let html = `<div style="font-size:13px;color:#475569;margin-bottom:8px">Origem do saldo por subconta</div>`;
  html += `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px">`;
  html += `<thead><tr style="text-align:left;color:#64748b;font-size:12px"><th>Subconta</th><th style="text-align:right">Saldo</th><th style="text-align:right">Lançs</th></tr></thead><tbody>`;
  let c = conta.firstChild;
  while (c) {
    const contasFilhas = coletarContas(c);
    const allLancs = contasFilhas.flatMap(cc => cc.lancamentos.map(l => ({ lanc: l, conta: cc })));
    const filteredAll = allLancs.filter(x => lancPassaFiltro(x.lanc));
    const saldo = filteredAll.reduce((s, it) => s + (it.lanc.tipo === 'credito' ? Number(it.lanc.valor || 0) : -Number(it.lanc.valor || 0)), 0);
    html += `<tr class="breakdown-row" data-id="${c.id}" data-parent="${conta.id}" style="border-top:1px solid #eef2f7">`;
    html += `<td style="padding:6px 8px;cursor:pointer"><button class="breakdown-select" style="margin-right:8px">🔎</button>${escapeHtml(c.nome)}</td>`;
    html += `<td style="text-align:right;padding:6px 8px;color:${saldo>=0?'#16a34a':'#dc2626'}">${formatMoeda(saldo)}</td>`;
    html += `<td style="text-align:right;padding:6px 8px;color:#94a3b8">${filteredAll.length}<button class="breakdown-expand-btn" style="margin-left:8px">▾</button></td>`;
    html += `</tr>`;
    filteredAll.sort((a, b) => parseLocalDate(b.lanc.data).getTime() - parseLocalDate(a.lanc.data).getTime());
    const top = filteredAll.slice(0, maxItems);
    html += `<tr id="break-exp-${c.id}" style="display:none;background:#fbfdff"><td colspan="3" style="padding:8px 12px">`;
    if (top.length === 0) {
      html += `<div style="color:#94a3b8;font-size:13px">Sem lançamentos nesta subconta.</div>`;
    } else {
      html += `<ul style="margin:0;padding-left:18px">`;
      for (const { lanc: l, conta: cc } of top) {
        const sinal = l.tipo === 'credito' ? '+' : '−';
        html += `<li style="margin-bottom:6px;font-size:13px">${sinal} ${formatMoeda(l.valor)} — ${escapeHtml(l.descricao||'(sem descrição)')} <span style="color:#64748b">(${escapeHtml(cc.nome)})</span></li>`;
      }
      html += `</ul>`;
    }
    html += `</td></tr>`;
    c = c.nextSibling;
  }
  html += `</tbody></table>`;
  return html;
}

function _bindBreakdownEvents(container) {
  container.querySelectorAll('.breakdown-row').forEach(row => {
    const subId  = +row.dataset.id;
    const selBtn = row.querySelector('.breakdown-select');
    const expBtn = row.querySelector('.breakdown-expand-btn');
    const expRow = container.querySelector(`#break-exp-${subId}`);
    if (selBtn) selBtn.addEventListener('click', e => { e.stopPropagation(); selectConta(subId); });
    if (expBtn && expRow) expBtn.addEventListener('click', e => {
      e.stopPropagation();
      expRow.style.display = expRow.style.display === 'none' ? '' : 'none';
    });
  });
}

// ── Lançamento row helper ─────────────────────────────────────────────────────

function _buildLancRowHtml(l, buscaQ) {
  const isCredito = l.tipo === 'credito';
  const descRaw   = l.descricao || '(sem descrição)';
  let descHtml = escapeHtml(descRaw);
  if (buscaQ && descRaw.toLowerCase().includes(buscaQ)) {
    const idx    = descRaw.toLowerCase().indexOf(buscaQ);
    const antes  = escapeHtml(descRaw.slice(0, idx));
    const trecho = escapeHtml(descRaw.slice(idx, idx + buscaQ.length));
    const depois = escapeHtml(descRaw.slice(idx + buscaQ.length));
    descHtml = `${antes}<mark class="lanc-highlight">${trecho}</mark>${depois}`;
  }
  const forn = (!isCredito && l.fornecedor_id && typeof window.fornRepo !== 'undefined')
    ? window.fornRepo.findById(l.fornecedor_id) : null;
  const mostrarRecibo = forn && forn.tipoPessoa === 'fisica';
  const corValor = isCredito ? '#16a34a' : '#dc2626';
  const sinal    = isCredito ? '+' : '−';
  return `
    <div class="lanc-row" data-lanc-id="${l.id}">
      <div class="lanc-tipo-icon ${l.tipo}" title="${isCredito ? 'Crédito' : 'Débito'}">${isCredito ? 'C' : 'D'}</div>
      <div class="lanc-info">
        <span class="lanc-descricao">${descHtml}</span>
        <span class="lanc-data">${formatLocalDate(l.data)}</span>
      </div>
      <div class="lanc-valor" style="color:${corValor}">${sinal} ${formatMoeda(l.valor)}</div>
      ${mostrarRecibo ? `<button class="lanc-recibo-btn" data-id="${l.id}" title="Gerar Recibo de Autônomo">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      </button>` : ''}
      <button class="lanc-edit-btn" data-id="${l.id}" title="Editar lançamento">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="lanc-del-btn" data-id="${l.id}" title="Excluir lançamento">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>
    </div>`;
}

function _bindLancEvents(container, conta) {
  container.querySelectorAll('.lanc-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lancId = +btn.dataset.id;
      let contaDoLanc = null, lancObj = null;
      for (const cc of coletarContas(conta)) {
        const found = cc.lancamentos.find(l => l.id === lancId);
        if (found) { contaDoLanc = cc; lancObj = found; break; }
      }
      if (contaDoLanc && lancObj) abrirModalEditarLancamento(contaDoLanc, lancObj);
    });
  });

  container.querySelectorAll('.lanc-recibo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lancId = +btn.dataset.id;
      let contaDoLanc = null, lancObj = null;
      for (const cc of coletarContas(conta)) {
        const found = cc.lancamentos.find(l => l.id === lancId);
        if (found) { contaDoLanc = cc; lancObj = found; break; }
      }
      if (!lancObj) return;
      const forn = (typeof window.fornRepo !== 'undefined' && lancObj.fornecedor_id)
        ? window.fornRepo.findById(lancObj.fornecedor_id) : null;
      if (!forn) { showToast('Fornecedor não encontrado para este lançamento.', 'warning'); return; }
      if (typeof abrirReciboAutonomo === 'function') abrirReciboAutonomo({ lancamento: lancObj, conta: contaDoLanc, fornecedor: forn });
    });
  });

  container.querySelectorAll('.lanc-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.confirmPending) {
        clearTimeout(btn._delTimer);
        const lancId = +btn.dataset.id;
        const lanc   = conta.lancamentos.find(l => l.id === lancId);
        const dbId   = lanc?.db_id;
        repo.removerLancamento(conta, lancId);
        renderTree();
        mostrarDetalhe(conta);
        showToast('Lançamento excluído.', 'info');
        if (dbId) {
          (async function() {
            try {
              const resp = await fetch(apiUrl('/api/lancamentos/' + dbId), { method: 'DELETE', credentials: 'include' });
              const j = await resp.json();
              if (!j.ok) showToast('Erro ao excluir lançamento: ' + (j.erro || 'falha desconhecida'), 'error');
            } catch(e) { showToast('Sem conexão com o servidor ao excluir lançamento.', 'error'); }
          })();
        }
      } else {
        btn.dataset.confirmPending = '1';
        btn.title = 'Clique novamente para confirmar';
        btn.classList.add('lanc-del-confirm');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
        btn._delTimer = setTimeout(() => {
          delete btn.dataset.confirmPending;
          btn.title = 'Excluir lançamento';
          btn.classList.remove('lanc-del-confirm');
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>`;
        }, 2500);
      }
    });
  });

  const loadMoreBtn = container.querySelector('.lanc-load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      _lancPage += 1;
      renderLancamentos(conta);
      loadMoreBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}

// ── renderLancamentos ─────────────────────────────────────────────────────────

function renderLancamentos(conta) {
  const container = document.getElementById('detailLancamentos');
  const titleEl   = document.getElementById('detailLancTitle');
  const resumoEl  = document.getElementById('lancFiltroResumo');
  if (!container) return;

  log.debug('renderLancamentos conta', conta?.id, 'hasChildren:', conta?.hasChildren);

  // Parent accounts show breakdown only (no individual lancamentos list)
  if (conta && conta.hasChildren) {
    try {
      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.id = 'breakdownInjected';
      wrap.innerHTML = _buildBreakdownHtml(conta);
      container.appendChild(wrap);
      _bindBreakdownEvents(wrap);
    } catch(e) {}
    return;
  }

  let lista = _lancamentosFiltrados(conta);
  lista = lista.slice().sort((a, b) => {
    const da = parseLocalDate(a.data).getTime();
    const db = parseLocalDate(b.data).getTime();
    if (db !== da) return db - da;
    return (b.db_id || b.id || 0) - (a.db_id || a.id || 0);
  });

  if (titleEl) {
    const totalConta = coletarContas(conta).flatMap(cc => cc.lancamentos || []).length;
    const mostrando  = lista.length;
    titleEl.innerHTML = `Lançamentos desta conta
      <span style="font-size:12px;font-weight:400;color:#64748b;margin-left:6px">
        ${mostrando < totalConta ? `${mostrando} de ${totalConta}` : totalConta}
        ${totalConta === 1 ? 'registro' : 'registros'}
      </span>`;
  }

  if (resumoEl) {
    if (lista.length === 0) {
      resumoEl.style.display = 'none';
    } else {
      const totalC = lista.filter(l => l.tipo === 'credito').reduce((s, l) => s + Number(l.valor || 0), 0);
      const totalD = lista.filter(l => l.tipo === 'debito').reduce((s, l) => s + Number(l.valor || 0), 0);
      const corSaldo = (totalC - totalD) >= 0 ? '#16a34a' : '#dc2626';
      resumoEl.innerHTML = `${totalC>0?`<span class="lanc-resumo-item credito">C ${formatMoeda(totalC)}</span>`:''}${totalD>0?`<span class="lanc-resumo-item debito">D ${formatMoeda(totalD)}</span>`:''}<span class="lanc-resumo-saldo" style="color:${corSaldo}">Saldo: ${(totalC-totalD)>=0?'+':'−'}${formatMoeda(Math.abs(totalC-totalD))}</span>`;
      resumoEl.style.display = '';
    }
  }

  if (lista.length === 0) {
    const temFiltro = !!(lancFiltro.dtI || lancFiltro.dtF || lancFiltro.busca);
    container.innerHTML = `
      <div class="lanc-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"></path></svg>
        <span>${temFiltro
          ? 'Nenhum lançamento encontrado com estes filtros.'
          : 'Nenhum lançamento. Clique em <strong>Novo Lançamento</strong>.'}</span>
      </div>`;
    return;
  }

  const buscaQ  = lancFiltro.busca.trim().toLowerCase();
  const visiveis = lista.slice(0, _lancPage * LANC_PAGE_SIZE);
  let html = visiveis.map(l => _buildLancRowHtml(l, buscaQ)).join('');
  if (lista.length > visiveis.length) {
    html += `<div class="lanc-load-more-wrap">
      <button class="btn btn-sm btn-outline lanc-load-more-btn">
        Carregar mais <span class="lanc-load-more-count">(+${lista.length - visiveis.length} restantes)</span>
      </button>
    </div>`;
  }

  container.innerHTML = html;
  _bindLancEvents(container, conta);
}

// ── Modal de Lançamento ────────────────────────────────────────────────────
let _lancContaAtual = null;
let _lancTipoAtual  = 'credito';
let _lancEditandoId = null;  // id local (memória) do lançamento em edição; null = novo

// ── Autocomplete de fornecedor ────────────────────────────────────────────
let _fornAutoAllData = [];

function _atualizarGerarReciboVisib(forn) {
  const row  = document.getElementById('gerarReciboRow');
  const nome = document.getElementById('gerarReciboFornNome');
  if (!row) return;
  const mostrar = forn && forn.tipoPessoa === 'fisica' && _lancTipoAtual === 'debito' && _lancEditandoId === null;
  row.style.display = mostrar ? '' : 'none';
  if (!mostrar) { const chk = document.getElementById('chkGerarRecibo'); if (chk) chk.checked = false; }
  if (nome) nome.textContent = (forn && mostrar) ? '(' + (forn.razaoSocial || '') + ')' : '';
}

function _fornAutoRenderList(q) {
  const list   = document.getElementById('fornAutoList');
  const hidden = document.getElementById('inputLancFornecedor');
  if (!list) return;

  const lower = (q || '').toLowerCase().trim();
  let filtered = _fornAutoAllData.filter(f => {
    if (!lower) return true;
    return (f.nomeFantasia || '').toLowerCase().includes(lower)
        || (f.razaoSocial  || '').toLowerCase().includes(lower)
        || (f.cnpj || '').includes(lower)
        || (f.cpf  || '').includes(lower);
  });

  if (!filtered.length) {
    list.innerHTML = `<div style="padding:10px 12px;color:var(--c-text-muted);font-size:13px">Nenhum fornecedor encontrado.</div>`;
    list.style.display = '';
    return;
  }

  list.innerHTML = filtered.map(f => {
    const nome = f.nomeFantasia || f.razaoSocial || '(sem nome)';
    const sub  = f.nomeFantasia ? f.razaoSocial : '';
    const doc  = f.tipoPessoa === 'fisica' ? f.cpf : f.cnpj;
    const tipo = f.tipoPessoa === 'fisica' ? 'PF' : 'PJ';
    const sel  = String(f.id) === String(hidden?.value || '') ? 'forn-auto-item selected' : 'forn-auto-item';
    return `<div class="${sel}" data-fid="${f.id}">
      <div class="forn-auto-nome">${escapeHtml(nome)}</div>
      <div class="forn-auto-sub">${tipo}${doc ? ' · ' + escapeHtml(doc) : ''}${sub ? ' · ' + escapeHtml(sub) : ''}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.forn-auto-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const forn = _fornAutoAllData.find(f => String(f.id) === item.dataset.fid);
      if (forn) {
        document.getElementById('inputLancFornecedor').value = forn.id;
        document.getElementById('inputLancFornecedorBusca').value = forn.nomeFantasia || forn.razaoSocial || '';
        _atualizarGerarReciboVisib(forn);
      }
      list.style.display = 'none';
    });
  });

  list.style.display = '';
}

function _popularFornecedoresSelect(contaId, selectedId) {
  try {
    const forns = typeof window.getFornecedoresDaConta === 'function'
      ? window.getFornecedoresDaConta(contaId) : [];
    if (selectedId && typeof window.fornRepo !== 'undefined') {
      const jaNaLista = forns.some(f => String(f.id) === String(selectedId));
      if (!jaNaLista) {
        const forn = window.fornRepo.findById(Number(selectedId));
        if (forn) forns.push(forn);
      }
    }
    _fornAutoAllData = forns;
  } catch(e) { _fornAutoAllData = []; }

  const busca  = document.getElementById('inputLancFornecedorBusca');
  const hidden = document.getElementById('inputLancFornecedor');
  const list   = document.getElementById('fornAutoList');
  if (!busca || !hidden || !list) return;

  hidden.value = '';
  busca.value  = '';
  list.style.display = 'none';

  // Restaurar seleção anterior
  if (selectedId) {
    const forn = _fornAutoAllData.find(f => String(f.id) === String(selectedId));
    if (forn) {
      hidden.value = forn.id;
      busca.value  = forn.nomeFantasia || forn.razaoSocial || '';
    }
  }

  busca.oninput = () => {
    hidden.value = '';
    _atualizarGerarReciboVisib(null);
    _fornAutoRenderList(busca.value);
  };
  busca.onfocus = () => _fornAutoRenderList(busca.value);
  busca.onblur  = () => setTimeout(() => {
    if (list) list.style.display = 'none';
    // Se digitou sem selecionar, limpar
    if (busca.value && !hidden.value) busca.value = '';
  }, 180);
}

// ── Gerenciamento de itens do lançamento ──────────────────────────────────

function _addLancItem(desc, valor) {
  const container = document.getElementById('lancItensContainer');
  if (!container) return null;
  const row = document.createElement('div');
  row.className = 'lanc-item-row';
  row.innerHTML = `
    <input type="text" class="input-text lanc-item-desc"
           placeholder="Ex: GASOLINA, ÓLEO DIESEL…" maxlength="120"
           style="text-transform:uppercase" value="${escapeHtml(desc || '')}">
    <input type="number" class="input-text lanc-item-valor"
           placeholder="0,00" min="0.01" step="0.01"
           value="${valor != null && valor !== '' ? valor : ''}">
    <button type="button" class="icon-btn danger lanc-item-remove" title="Remover item">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`;
  row.querySelector('.lanc-item-valor').addEventListener('input', _updateLancTotal);
  row.querySelector('.lanc-item-remove').addEventListener('click', () => {
    row.remove();
    _updateLancTotal();
    if (!document.querySelectorAll('#lancItensContainer .lanc-item-row').length) _addLancItem();
  });
  container.appendChild(row);
  _updateLancTotal();
  return row;
}

function _clearLancItens() {
  const container = document.getElementById('lancItensContainer');
  if (container) container.innerHTML = '';
}

function _updateLancTotal() {
  const total = [...document.querySelectorAll('#lancItensContainer .lanc-item-valor')]
    .reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
  const el = document.getElementById('lancTotalDisplay');
  if (el) el.textContent = 'R$ ' + total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _getLancItens() {
  return [...document.querySelectorAll('#lancItensContainer .lanc-item-row')].map(row => ({
    descricao: (row.querySelector('.lanc-item-desc')?.value?.trim() || '').toUpperCase(),
    valor:     parseFloat(row.querySelector('.lanc-item-valor')?.value || 0) || 0,
  }));
}

function abrirModalLancamento(conta) {
  _lancContaAtual = conta;
  _lancEditandoId = null;
  _lancTipoAtual  = conta.tipo === 'Saída' ? 'debito' : 'credito';

  const modal = document.getElementById('modalLancamento');
  const titulo = document.getElementById('tituloLancamento');
  if (titulo) titulo.textContent = 'Novo Lançamento';
  document.getElementById('lancContaCodigo').textContent = conta.codigo;
  document.getElementById('lancContaNome').textContent   = conta.nome;
  const badge = document.getElementById('lancTipoBadge');
  if (badge) {
    badge.textContent  = _lancTipoAtual === 'credito' ? 'Crédito' : 'Débito';
    badge.className    = 'lanc-tipo-badge ' + _lancTipoAtual;
  }

  document.getElementById('inputLancData').value = new Date().toISOString().split('T')[0];
  _popularFornecedoresSelect(conta.id, '');
  _atualizarGerarReciboVisib(null);
  _clearLancItens();
  _addLancItem();

  modal.style.display = 'flex';
  trapFocus(modal);
  setTimeout(() => document.querySelector('#lancItensContainer .lanc-item-desc')?.focus(), 80);
}

function abrirModalEditarLancamento(conta, lanc) {
  if (!authCan('editLancamento')) {
    showToast('Sem permissão para editar lançamentos.', 'warning'); return;
  }
  _lancContaAtual = conta;
  _lancEditandoId = lanc.id;
  _lancTipoAtual  = lanc.tipo || (conta.tipo === 'Saída' ? 'debito' : 'credito');

  const modal = document.getElementById('modalLancamento');
  const titulo = document.getElementById('tituloLancamento');
  if (titulo) titulo.textContent = 'Editar Lançamento';
  document.getElementById('lancContaCodigo').textContent = conta.codigo;
  document.getElementById('lancContaNome').textContent   = conta.nome;
  const badge = document.getElementById('lancTipoBadge');
  if (badge) {
    badge.textContent = _lancTipoAtual === 'credito' ? 'Crédito' : 'Débito';
    badge.className   = 'lanc-tipo-badge ' + _lancTipoAtual;
  }

  document.getElementById('inputLancData').value = lanc.data || '';
  _popularFornecedoresSelect(conta.id, lanc.fornecedor_id || '');

  // Restaurar itens: usa lanc.itens se existir, senão monta um item a partir dos campos legados
  _clearLancItens();
  const itens = (lanc.itens && lanc.itens.length)
    ? lanc.itens
    : [{ descricao: lanc.descricao || '', valor: lanc.valor || 0 }];
  itens.forEach(i => _addLancItem(i.descricao, i.valor));

  modal.style.display = 'flex';
  trapFocus(modal);
  setTimeout(() => document.querySelector('#lancItensContainer .lanc-item-desc')?.focus(), 80);
}

// Alias para lancamentos-page.js
window.editarLancamento = abrirModalEditarLancamento;

function _setLancTipo(tipo) {
  _lancTipoAtual = tipo;
  const btnC = document.getElementById('btnLancCredito');
  const btnD = document.getElementById('btnLancDebito');
  if (btnC) btnC.classList.toggle('active', tipo === 'credito');
  if (btnD) btnD.classList.toggle('active', tipo === 'debito');
}

function confirmarLancamento() {
  const conta = _lancContaAtual;
  if (!conta) return;

  // Coletar e validar itens
  const itens = _getLancItens();
  const itensValidos = itens.filter(i => i.descricao || i.valor > 0);

  if (!itensValidos.length) {
    showToast('Adicione pelo menos um item com descrição e valor.', 'warning');
    document.querySelector('#lancItensContainer .lanc-item-desc')?.focus();
    return;
  }

  const itemInvalido = itensValidos.find(i => !i.descricao || i.valor <= 0);
  if (itemInvalido) {
    showToast('Preencha a descrição e o valor de todos os itens.', 'warning');
    return;
  }

  const fornSel = document.getElementById('inputLancFornecedor');
  if (!fornSel || !fornSel.value) {
    showToast('Selecione um fornecedor antes de lançar.', 'warning');
    fornSel?.focus();
    return;
  }

  const valor = itensValidos.reduce((s, i) => s + i.valor, 0);
  const descricao = itensValidos.length === 1
    ? itensValidos[0].descricao
    : itensValidos.map(i => i.descricao).join(' / ');
  const data = document.getElementById('inputLancData').value;

  // Modo edição
  if (_lancEditandoId !== null) {
    _editarLancamento(conta, _lancEditandoId, valor, descricao, data, itensValidos);
    return;
  }

  // Verificar orçamento antes de salvar
  if (conta.orcamento > 0) {
    const realizado = repo.realizadoOrcamento(conta);
    const novoSaldo = realizado + valor;
    const vai_exceder = novoSaldo > conta.orcamento;
    const ja_excedido = realizado > conta.orcamento;
    if (vai_exceder && !ja_excedido) {
      const excesso = novoSaldo - conta.orcamento;
      confirmar(
        '⚠ Orçamento será excedido',
        `Este lançamento de ${formatMoeda(valor)} vai ultrapassar o orçamento de "${conta.nome}" em ${formatMoeda(excesso)}.\n\nOrçamento: ${formatMoeda(conta.orcamento)}\nRealizado atual: ${formatMoeda(realizado)}\nApós lançamento: ${formatMoeda(novoSaldo)}\n\nDeseja continuar mesmo assim?`,
        () => _gravarLancamento(conta, valor, descricao, data, itensValidos),
        { confirmLabel: 'Sim, lançar mesmo assim', confirmClass: 'btn-danger' }
      );
      return;
    }
  }

  _gravarLancamento(conta, valor, descricao, data, itensValidos);
}

function _gravarLancamento(conta, valor, descricao, data, itens) {
  const lanc   = new Lancamento(_lancTipoAtual, valor, descricao, data);
  lanc.itens   = itens || [];
  const fornSel = document.getElementById('inputLancFornecedor');
  if (fornSel && fornSel.value) lanc.fornecedor_id = Number(fornSel.value);

  // Capturar antes de fechar o modal
  const _gerarRecibo = document.getElementById('chkGerarRecibo')?.checked === true;
  const _fornIdRecibo = fornSel ? Number(fornSel.value) : null;

  const alerta = repo.inserirLancamento(conta, lanc);

  fecharModalLancamento();
  renderTree();
  mostrarDetalhe(conta);

  const tipoLabel = _lancTipoAtual === 'credito' ? 'Crédito' : 'Débito';
  showToast(`${tipoLabel} de ${formatMoeda(valor)} lançado em "${conta.nome}".`, 'success');

  // Gerar recibo de autônomo se solicitado
  if (_gerarRecibo && _fornIdRecibo && typeof abrirReciboAutonomo === 'function') {
    try {
      const fornRecibo = (typeof window.fornRepo !== 'undefined') ? window.fornRepo.findById(_fornIdRecibo) : null;
      if (fornRecibo) setTimeout(() => abrirReciboAutonomo({ lancamento: lanc, conta, fornecedor: fornRecibo }), 150);
    } catch(e) { log.warn('Erro ao gerar recibo:', e); }
  }

  // Enviar ao backend (MySQL) de forma assíncrona — não bloqueia a UI
  (async function() {
    try {
      const resp = await fetch(apiUrl('/api/lancamentos'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conta_codigo:  conta.codigo_banco || conta.codigo,
          conta_ext_id:  conta.codigo_banco || conta.codigo,
          conta_nome:    conta.nome,
          conta_natureza: conta.tipo || '',
          data,
          tipo:          _lancTipoAtual,
          valor,
          descricao,
          fornecedor_id: lanc.fornecedor_id || null
        })
      });
      const j = await resp.json();
      if (!j.ok) {
        showToast('Erro ao salvar lançamento: ' + (j.erro || 'falha desconhecida'), 'error');
        repo.removerLancamento(conta, lanc.id);
        renderTree();
        mostrarDetalhe(conta);
      } else {
        log.debug('[API] Lançamento salvo no banco, id=', j.id);
        lanc.db_id = j.id;
        repo.salvar();
      }
    } catch(e) {
      showToast('Sem conexão com o servidor ao salvar lançamento.', 'error');
      repo.removerLancamento(conta, lanc.id);
      renderTree();
      mostrarDetalhe(conta);
    }
  })();

  // Alertas de orçamento
  if (alerta === 'excedido') {
    setTimeout(() => showToast(
      `⚠ Orçamento de "${conta.nome}" foi EXCEDIDO! (${repo.percentualOrcamento(conta).toFixed(1)}%)`,
      'error'
    ), 600);
  } else if (alerta === 'atencao') {
    setTimeout(() => showToast(
      `⚠ "${conta.nome}" atingiu ${repo.percentualOrcamento(conta).toFixed(1)}% do orçamento.`,
      'warning'
    ), 600);
  }
}

function fecharModalLancamento() {
  try {
    const modal = document.getElementById('modalLancamento');
    if (modal) modal.style.display = 'none';
    _lancEditandoId = null;
    // soltar trapFocus se implementado
    try { if (typeof releaseFocus === 'function') releaseFocus(); } catch(e) {}
  } catch(e) { /* não bloquear */ }
}

function _editarLancamento(conta, lancId, valor, descricao, data, itens) {
  const lanc = conta.lancamentos.find(l => l.id === lancId);
  if (!lanc) { showToast('Lançamento não encontrado.', 'error'); return; }

  const dbId       = lanc.db_id;
  const valorOld   = lanc.valor;
  lanc.valor       = valor;
  lanc.descricao   = descricao;
  lanc.data        = data;
  lanc.itens       = itens || [];
  const fornSel = document.getElementById('inputLancFornecedor');
  lanc.fornecedor_id = (fornSel && fornSel.value) ? Number(fornSel.value) : null;

  repo.salvar();
  fecharModalLancamento();
  renderTree();
  mostrarDetalhe(conta);
  showToast(`Lançamento atualizado: ${formatMoeda(valor)}.`, 'info');

  // Sincronizar com o banco
  if (dbId) {
    (async () => {
      try {
        const resp = await fetch(apiUrl('/api/lancamentos/' + dbId), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data, tipo: lanc.tipo, valor, descricao, fornecedor_id: lanc.fornecedor_id || null })
        });
        const j = await resp.json();
        if (!j.ok) {
          showToast('Erro ao salvar edição no banco: ' + (j.erro || 'falha'), 'error');
          // Reverter valor em memória se o banco rejeitou
          lanc.valor = valorOld;
          repo.salvar();
          renderTree();
          mostrarDetalhe(conta);
        }
      } catch(e) {
        showToast('Sem conexão ao salvar edição.', 'error');
      }
    })();
  }
}

// ── Navegação por setas ────────────────────────────────────────────────────
function navegarArvore(direcao) {
  // Coleta somente linhas visíveis na ordem atual da DOM
  const allRows = [...document.querySelectorAll('.tree-node-row')];
  const rows = allRows.filter(r => r.offsetParent !== null);
  if (!rows.length) return;

  const ids = rows.map(r => +r.dataset.id);
  const currentId = treeState.selectedId;
  const currentConta = currentId ? repo.findById(currentId) : null;

  // Helper: linhas que representam grupos de primeiro nível (filhas diretas do root)
  const rootGroupRows = rows.filter(r => {
    const c = repo.findById(+r.dataset.id);
    return !!(c && c.parent && c.parent.isRoot);
  });

  // Se não houver seleção, seleciona o primeiro grupo
  if (!currentConta) {
    if (rootGroupRows.length) {
      const id0 = +rootGroupRows[0].dataset.id;
      selectConta(id0);
      rootGroupRows[0].scrollIntoView({ block: 'nearest' });
    }
    return;
  }

  const isRootLevel = !!(currentConta.parent && currentConta.parent.isRoot);
  const isExpanded = treeState.expanded.has(currentConta.id);

  // Se a conta atual é um grupo de primeiro nível e NÃO está expandida,
  // movemos apenas entre os grupos (rootGroupRows).
  if (isRootLevel && !isExpanded) {
    const rgIds = rootGroupRows.map(r => +r.dataset.id);
    const ridx = rgIds.indexOf(currentId);
    if (ridx === -1) return;
    const novoRidx = Math.max(0, Math.min(rgIds.length - 1, ridx + direcao));
    const nextId = rgIds[novoRidx];
    selectConta(nextId);
    const nextRow = rows.find(r => +r.dataset.id === nextId);
    if (nextRow) nextRow.scrollIntoView({ block: 'nearest' });
    return;
  }

  // Caso contrário, navegamos entre todas as linhas visíveis (inclusive filhos se aberto)
  const idx = ids.indexOf(currentId);
  const novoIdx = Math.max(0, Math.min(ids.length - 1, idx + direcao));
  selectConta(ids[novoIdx]);
  rows[novoIdx]?.scrollIntoView({ block: 'nearest' });
}

// ── Adicionar conta ────────────────────────────────────────────────────────
function _criarConta(nome, pai) {
  if (!pai) return;
  const novaConta = new ContaGerencial(nome);
  pai.addChild(novaConta);
  treeState.expanded.add(pai.id);
  repo.salvar();
  renderTree();
  selectConta(novaConta.id);
  showToast(`Conta "${novaConta.nome}" adicionada com sucesso!`, 'success');

  // Sincronizar com o banco
  (async function() {
    try {
      const parentCodigo = pai.codigo_banco || pai.codigo;
      const resp = await fetch(apiUrl('/api/contas'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parent_codigo: parentCodigo,
          nome: novaConta.nome,
          natureza: novaConta.tipo === 'Entrada' ? 'entrada' : 'saida'
        })
      });
      const j = await resp.json();
      if (!j.ok) showToast('Erro ao criar conta: ' + (j.erro || 'falha desconhecida'), 'error');
      else {
        log.debug('[API] Conta criada no banco, codigo=', j.codigo);
        novaConta.codigo_banco = j.codigo;
        repo.salvar();
      }
    } catch(e) { showToast('Sem conexão com o servidor ao criar conta.', 'error'); }
  })();
}

// Note: reparenting behavior removed. Creating as root sibling is handled in adicionarConta().

// ── Remover conta ──────────────────────────────────────────────────────────
function removerConta() {
  if (!treeState.selectedId) return;
  if (!authCan('removeConta')) {
    showToast('Sem permissão para remover contas.', 'warning'); return;
  }
  const conta = repo.findById(treeState.selectedId);
  if (!conta || conta.isRoot) return;

  if (conta.hasChildren) {
    confirmar(
      'Remoção bloqueada',
      `A conta "${conta.nome}" possui ${conta.totalDescendants} subconta(s). Remova as subcontas primeiro.`,
      () => {},
      { confirmLabel: 'Entendido', confirmClass: 'btn-secondary' }
    );
    return;
  }

  const temLanc = conta.lancamentos.length > 0;
  confirmar(
    'Remover Conta',
    `Remover "${conta.nome}"?${temLanc ? `\n\nAtenção: esta conta possui ${conta.lancamentos.length} lançamento(s) que também serão excluídos.` : ''}`,
    () => {
      // snapshot/undo removed
      const parentId = conta.parent?.id;
      const codigoConta = conta.codigo_banco || conta.codigo; // capturar antes de remover
      repo.removerConta(conta);
      treeState.selectedId = parentId || null;
      renderTree();
      if (parentId) selectConta(parentId);
      else {
        welcomeState.style.display = '';
        contaDetail.style.display  = 'none';
        if (selectedParentDisp) {
          selectedParentDisp.innerHTML = '<em>Nenhuma conta selecionada</em>';
          selectedParentDisp.className = 'selected-parent-display';
        }
      }
      showToast(`Conta "${conta.nome}" removida.`, 'success');

      // Sincronizar com o banco
      (async function() {
        try {
          const resp = await fetch(apiUrl('/api/contas/' + encodeURIComponent(codigoConta)), {
            method: 'DELETE',
            credentials: 'include'
          });
          const j = await resp.json();
          if (!j.ok) showToast('Erro ao excluir conta: ' + (j.erro || 'falha desconhecida'), 'error');
          else log.debug('[API] Conta excluída do banco, codigo=', codigoConta);
        } catch(e) { showToast('Sem conexão com o servidor ao excluir conta.', 'error'); }
      })();
    }
  );
}

// ── Renomear (modal) ───────────────────────────────────────────────────────
function abrirModalRenomear() {
  if (!treeState.selectedId) return;
  if (window._authCanRename === false) {
    showToast('Sem permissão para renomear contas.', 'warning'); return;
  }
  const conta = repo.findById(treeState.selectedId);
  if (!conta || conta.isRoot) return;
  inputRenomear.value = conta.nome;
  modalRenomear.style.display = 'flex';
  trapFocus(modalRenomear);
  setTimeout(() => { inputRenomear.focus(); inputRenomear.select(); }, 50);
}

function confirmarRenomear() {
  const novoNome = inputRenomear.value.trim();
  if (!novoNome) { showToast('O nome não pode ser vazio.', 'warning'); return; }
  const conta = repo.findById(treeState.selectedId);
  if (!conta) return;
  const nomeOld = conta.nome;
  const codigoBanco = conta.codigo_banco;
  conta.nome = novoNome.toUpperCase().trim();
  repo.salvar();
  modalRenomear.style.display = 'none';
  renderTree();
  selectConta(conta.id);
  showToast(`Conta renomeada: "${nomeOld}" → "${conta.nome}"`, 'info');

  // Sincronizar com banco
  if (codigoBanco) {
    (async () => {
      try {
        const resp = await fetch(apiUrl('/api/contas/' + encodeURIComponent(codigoBanco)), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nome: conta.nome })
        });
        const j = await resp.json();
        if (!j.ok) showToast('Erro ao renomear conta: ' + (j.erro || 'falha desconhecida'), 'error');
      } catch(e) { showToast('Sem conexão com o servidor ao renomear conta.', 'error'); }
    })();
  }
}

// ── Renomear inline (dblclick) ─────────────────────────────────────────────
function iniciarRenomearInline(labelEl, conta) {
  const input = document.createElement('input');
  input.type  = 'text';
  input.value = conta.nome;
  input.className = 'node-label editing';
  input.maxLength = 80;

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const finalizar = () => {
    const novoNome = input.value.trim();
    if (novoNome && !conta.isRoot) {
      const codigoBanco = conta.codigo_banco;
      conta.nome = novoNome.toUpperCase().trim();
      repo.salvar();
      // Sincronizar com banco
      if (codigoBanco) {
        (async () => {
          try {
            const resp = await fetch(apiUrl('/api/contas/' + encodeURIComponent(codigoBanco)), {
              method: 'PUT',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ nome: conta.nome })
            });
            const j = await resp.json();
            if (!j.ok) showToast('Erro ao renomear conta: ' + (j.erro || 'falha desconhecida'), 'error');
          } catch(e) { showToast('Sem conexão com o servidor ao renomear conta.', 'error'); }
        })();
      }
    }
    renderTree();
    selectConta(conta.id);
  };

  input.addEventListener('blur',  finalizar);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { input.blur(); }
    if (e.key === 'Escape') { input.value = conta.nome; input.blur(); }
  });
}

// ── Mover conta (drag & drop) ──────────────────────────────────────────────
function moverConta(srcId, dstId, position = 'inside') {
  const src = repo.findById(srcId);
  const dst = repo.findById(dstId);
  if (!src || !dst) return;
  if (src.isRoot) return;

  // Não mover para descendente de si mesmo
  let c = dst;
  while (c) { if (c.id === src.id) return; c = c.parent; }

  // Remove do pai atual
  if (src.parent) src.parent.removeChild(src);

  if (position === 'before' && dst.parent) {
    dst.parent.insertChildBefore(src, dst);
  } else if (position === 'after' && dst.parent) {
    dst.parent.insertChildAfter(src, dst);
  } else {
    dst.addChild(src);
    treeState.expanded.add(dst.id);
  }

  repo.salvar();
  renderTree();
  selectConta(src.id);
  const label = position === 'before' ? `antes de "${dst.nome}"` :
                position === 'after'  ? `depois de "${dst.nome}"` :
                `dentro de "${dst.nome}"`;
  showToast(`"${src.nome}" movido ${label}`, 'info');
}

function toggleExpandAll() {
  if (repo.root) coletarTodosIds(repo.root).forEach(id => treeState.expanded.add(id));
  renderTree();
  if (treeState.selectedId) selectConta(treeState.selectedId);
}

function coletarTodosIds(conta) {
  const ids = [conta.id];
  let c = conta.firstChild;
  while (c) { ids.push(...coletarTodosIds(c)); c = c.nextSibling; }
  return ids;
}

// ── Expandir caminho até a conta ───────────────────────────────────────────
function expandirAte(id) {
  const conta = repo.findById(id);
  if (!conta) return;
  let c = conta.parent;
  while (c) { treeState.expanded.add(c.id); c = c.parent; }
  renderTree();
  selectConta(id);
}

// ── Badge total ────────────────────────────────────────────────────────────
function updateBadge() {
  badgeTotal.textContent = `${repo.totalContas} conta${repo.totalContas !== 1 ? 's' : ''}`;
}

// ── Exportar XML ───────────────────────────────────────────────────────────
function exportarXML() {
  const xml  = repo.exportarXML();
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'plano_contas.xml';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exportação XML concluída com sucesso!', 'success');
}

// Undo/Redo removed — related functions deleted in this build.

// ── Sincronização multi-usuário (polling) ──────────────────────────────────
let _pollHash = null;

async function _fetchHash() {
  try {
    const r = await fetch(apiUrl('/api/contas/hash'), { credentials: 'include' });
    if (!r.ok) return null;
    const d = await r.json();
    return d.ok ? d.hash : null;
  } catch { return null; }
}

function _startPolling() {
  // Captura hash inicial silenciosamente
  _fetchHash().then(h => { if (h) _pollHash = h; });

  setInterval(async () => {
    if (document.hidden) return;

    const h = await _fetchHash();
    if (!h) return;

    if (_pollHash && h !== _pollHash) {
      _pollHash = h;
      const anoSel = document.getElementById('planoAnoFiltro');
      const ano = anoSel ? parseInt(anoSel.value, 10) : new Date().getFullYear();
      const prevId = treeState.selectedId;
      await repo.carregarDoBanco(ano);
      try { setShowOnly(treeState.showOnly); } catch(e) { renderTree(); }
      // Restaurar seleção se a conta ainda existe
      if (prevId && repo.findById(prevId)) selectConta(prevId);
      showToast('Plano atualizado por outro usuário.', 'info');
    } else {
      _pollHash = h;
    }
  }, 30000);
}

// ── Binding de eventos ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Preencher seletor de ano (ano corrente + 5 anos passados)
  const planoAnoSel = document.getElementById('planoAnoFiltro');
  if (planoAnoSel) {
    const anoAtual = new Date().getFullYear();
    for (let a = anoAtual; a >= anoAtual - 5; a--) {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      planoAnoSel.appendChild(opt);
    }
    planoAnoSel.value = anoAtual;
  }

  // Carregar árvore do banco (fonte de verdade), com fallback para localStorage
  (async () => {
    showSpinner('Carregando plano de contas…');
    const carregouDoBanco = await repo.carregarDoBanco();
    hideSpinner();
    if (carregouDoBanco) {
      console.info('[tree] Árvore carregada do banco de dados.');
      _startPolling();
    } else {
      console.warn('[tree] Usando dados do localStorage (banco indisponível).');
      showToast('Banco de dados indisponível. Exibindo dados locais.', 'warning');
    }
    treeState.expanded.clear();
    allExpanded = false;
    try { setShowOnly(treeState.showOnly); } catch(e) { renderTree(); }
  })();

  // Recarregar lançamentos ao mudar o ano
  if (planoAnoSel) {
    planoAnoSel.addEventListener('change', async () => {
      const ano = parseInt(planoAnoSel.value, 10);
      const indicador = document.getElementById('planoAnoCarregando');
      if (indicador) indicador.style.display = '';
      showSpinner('Carregando ' + ano + '…');
      await repo.carregarDoBanco(ano);
      hideSpinner();
      if (indicador) indicador.style.display = 'none';
      treeState.expanded.clear();
      allExpanded = false;
      selectConta(null);
      try { setShowOnly(treeState.showOnly); } catch(e) { renderTree(); }
    });
  }

  // Delegação: garante que cliques em linhas da árvore selecionem a conta mesmo
  // se algum listener individual foi sobrescrito ou removido acidentalmente.
  document.addEventListener('click', (e) => {
    const row = e.target.closest && e.target.closest('.tree-node-row');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (!isNaN(id)) selectConta(id);
  });

  // legacy quick-add removed; NOVO modal replaces quick add
  // legacy add-parent button removed; use NOVO modal for creation flows
  if (btnNovo) btnNovo.addEventListener('click', abrirModalNovo);

  // Modal novo
  const modalNovo = document.getElementById('modalNovo');
  const modalNovoClose = document.getElementById('modalNovoClose');
  const modalNovoCancel = document.getElementById('modalNovoCancel');
  const modalNovoConfirm = document.getElementById('modalNovoConfirm');
  const novoTipo = document.getElementById('novoTipo');
  const novoNome = document.getElementById('novoNome');
  const novoParentRow = document.getElementById('novoParentRow');
  const novoParentSelect = document.getElementById('novoParentSelect');
  const novoNatureza = document.getElementById('novoNatureza');
  if (modalNovoClose) modalNovoClose.addEventListener('click', () => fecharModalNovo());
  if (modalNovoCancel) modalNovoCancel.addEventListener('click', () => fecharModalNovo());
  if (novoTipo) novoTipo.addEventListener('change', () => { if (novoTipo.value === 'subconta') { novoParentRow.style.display = ''; preencherNovoParentSelect(); } else { novoParentRow.style.display = 'none'; } });
  if (novoNatureza) novoNatureza.addEventListener('change', () => { if (modalNovo && modalNovo.style.display !== 'none') preencherNovoParentSelect(); });
  if (modalNovoConfirm) modalNovoConfirm.addEventListener('click', confirmarModalNovo);

// Cria uma nova conta e a torna pai da conta atualmente selecionada


function abrirModalNovo() {
  if (!modalNovo) return;
  // preencher opções de pai de acordo com o tipo e natureza
  preencherNovoParentSelect();
  // reset fields
  novoTipo.value = 'grupo';
  if (novoNatureza) novoNatureza.value = 'saida';
  novoNome.value = '';
  novoParentRow.style.display = 'none';
  modalNovo.style.display = 'flex';
  novoNome.focus();
}

function preencherNovoParentSelect() {
  try {
    if (!novoParentSelect) return;
    novoParentSelect.innerHTML = '';
    const tipo = novoTipo?.value || 'grupo';
    const nat  = novoNatureza?.value || 'saida';
    // se for grupo, criar sob a raiz de natureza — listar filhos diretos da raiz como opções
    if (tipo === 'grupo') {
      if (!repo || !repo.root) return;
      let r = repo.root.firstChild;
      while (r) {
        const name = (r.nome || '').toUpperCase();
        if ((nat === 'entrada' && name.includes('ENTRAD')) || (nat === 'saida' && name.includes('SAID'))) {
          // listar apenas os filhos diretos da raiz (evitar incluir a própria raiz)
          let c = r.firstChild;
          while (c) { addDescendantsToSelect(c, novoParentSelect, 0); c = c.nextSibling; }
          return;
        }
        r = r.nextSibling;
      }
      return;
    }
    // subconta: encontrar a raiz ENTRADAS ou SAIDAS e listar seus descendentes
    if (!repo || !repo.root) return;
    let r = repo.root.firstChild;
    while (r) {
      const name = (r.nome || '').toUpperCase();
      if ((nat === 'entrada' && name.includes('ENTRAD')) || (nat === 'saida' && name.includes('SAID'))) {
        // listar filhos da raiz (evitando listar a própria raiz)
        let c = r.firstChild;
        while (c) { addDescendantsToSelect(c, novoParentSelect, 0); c = c.nextSibling; }
        break;
      }
      r = r.nextSibling;
    }
  } catch(e) { console.error('erro em preencherNovoParentSelect', e); }
}

function addDescendantsToSelect(node, selectEl, depth = 0) {
  if (!node) return;
  // label indentada para deixar hierarquia visível
  const pad = depth > 0 ? ' '.repeat(depth * 2) + '› ' : '';
  const label = pad + (node.nome || node.caminho || '');
  const opt = document.createElement('option'); opt.value = node.id; opt.textContent = label; selectEl.appendChild(opt);
  let c = node.firstChild;
  while (c) { addDescendantsToSelect(c, selectEl, depth + 1); c = c.nextSibling; }
}

function fecharModalNovo() {
  try { if (modalNovo) modalNovo.style.display = 'none'; } catch(e){}
}

function confirmarModalNovo() {
  const tipo = novoTipo.value;
  const nome = (novoNome.value || '').trim();
  if (!nome) { showToast('Informe o nome da conta.', 'warning'); novoNome.focus(); return; }
  if (tipo === 'grupo') {
    // Criar um novo grupo de nível superior dentro da raiz de natureza escolhida (ENTRADAS/SAIDAS)
    try {
      const nat = novoNatureza?.value || 'saida';
      if (!repo || !repo.root) { showToast('Estrutura do plano não está inicializada.', 'error'); return; }
      let r = repo.root.firstChild;
      while (r) {
        const name = (r.nome || '').toUpperCase();
        if ((nat === 'entrada' && name.includes('ENTRAD')) || (nat === 'saida' && name.includes('SAID'))) {
          _criarConta(nome.toUpperCase(), r);
          fecharModalNovo();
          return;
        }
        r = r.nextSibling;
      }
      // fallback: adicionar no root
      _criarConta(nome.toUpperCase(), repo.root);
      fecharModalNovo();
      return;
    } catch(e) { showToast('Erro ao criar conta: ' + e.message, 'error'); return; }
  }
  // subconta: usar parent selecionado no select
  const parentId = Number(novoParentSelect.value);
  const parent = repo.findById(parentId);
  if (!parent) { showToast('Pai inválido. Selecione um pai válido.', 'error'); return; }
  _criarConta(nome.toUpperCase(), parent);
  fecharModalNovo();
}

  btnRenomear.addEventListener('click', abrirModalRenomear);
  btnRemover.addEventListener('click',  removerConta);
  btnExportXML.addEventListener('click', exportarXML);

  // ── Modal de Lançamento ──
  document.getElementById('btnLancCredito')?.addEventListener('click', () => _setLancTipo('credito'));
  document.getElementById('btnLancDebito')?.addEventListener('click',  () => _setLancTipo('debito'));
  document.getElementById('btnConfirmarLancamento')?.addEventListener('click', confirmarLancamento);
  document.getElementById('btnCancelarLancamento')?.addEventListener('click',  fecharModalLancamento);
  document.getElementById('btnFecharLancamento')?.addEventListener('click',    fecharModalLancamento);
  document.getElementById('btnAdicionarItem')?.addEventListener('click', () => {
    const row = _addLancItem();
    if (row) setTimeout(() => row.querySelector('.lanc-item-desc')?.focus(), 40);
  });
  document.getElementById('modalLancamento')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modalLancamento')) fecharModalLancamento();
  });
  document.getElementById('inputLancValor')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmarLancamento();
    if (e.key === 'Escape') fecharModalLancamento();
  });
  document.getElementById('inputLancDescricao')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmarLancamento();
    if (e.key === 'Escape') fecharModalLancamento();
  });

  // ── Filtros de lançamentos ──
  function _contaAtualFiltro() {
    return treeState.selectedId ? repo.findById(treeState.selectedId) : null;
  }

  // Inicializar/usar filtros de visualização por ENTRADAS/SAIDAS (botões)
  function setShowOnly(mode) {
    // aceitar apenas 'entradas' ou 'saidas'; se inválido, manter o atual
    if (mode !== 'entradas' && mode !== 'saidas') {
      console.warn('setShowOnly: modo inválido', mode);
      return;
    }
    treeState.showOnly = mode;
    // localizar explicitamente a raiz correspondente e armazenar seu id
    try {
      if (repo && repo.root) {
        let r = repo.root.firstChild;
        treeState.viewRootId = null;
        while (r) {
          const name = (r.nome || '').toUpperCase();
          if (mode === 'entradas' && name.includes('ENTRAD')) { treeState.viewRootId = r.id; break; }
          if (mode === 'saidas'   && name.includes('SAID'))   { treeState.viewRootId = r.id; break; }
          r = r.nextSibling;
        }
      }
    } catch(e) { treeState.viewRootId = null; }
    if (btnShowEntradas) btnShowEntradas.classList.toggle('active-filter', treeState.showOnly === 'entradas');
    if (btnShowSaidas)   btnShowSaidas.classList.toggle('active-filter', treeState.showOnly === 'saidas');
    renderTree();
  }

  if (btnShowEntradas) btnShowEntradas.addEventListener('click', () => setShowOnly('entradas'));
  if (btnShowSaidas) btnShowSaidas.addEventListener('click', () => setShowOnly('saidas'));

  // Ao carregar, garantir estado inicial e renderizar (comportamento compatível)
  try { setShowOnly(treeState.showOnly || 'all'); } catch(e) { try { renderTree(); } catch(_) {} }

  // Filtro por tipo removido (tipo agora implícito pela natureza da conta). Não há listener de chips.

  // Datas
  document.getElementById('lancFiltroDtI')?.addEventListener('change', e => {
    e.stopPropagation();
    lancFiltro.dtI = e.target.value;
    _lancPage = 1;
    _atualizarBadgeFiltros();
    const c = _contaAtualFiltro(); if (c) renderLancamentos(c);
  });
  document.getElementById('lancFiltroDtF')?.addEventListener('change', e => {
    e.stopPropagation();
    lancFiltro.dtF = e.target.value;
    _lancPage = 1;
    _atualizarBadgeFiltros();
    const c = _contaAtualFiltro(); if (c) renderLancamentos(c);
  });

  // Limpar todos os filtros
  document.getElementById('btnLancLimparDatas')?.addEventListener('click', (e) => {
    e.stopPropagation();
    lancFiltro.dtI = ''; lancFiltro.dtF = ''; lancFiltro.busca = '';
    _lancPage = 1;
    const dtI = document.getElementById('lancFiltroDtI');
    const dtF = document.getElementById('lancFiltroDtF');
    const busca = document.getElementById('lancFiltroBusca');
    if (dtI) dtI.value = '';
    if (dtF) dtF.value = '';
    if (busca) busca.value = '';
    document.querySelectorAll('.lanc-atalho').forEach(b => b.classList.remove('active'));
    _atualizarBadgeFiltros();
    const c = _contaAtualFiltro(); if (c) renderLancamentos(c);
  });

  // Busca por descrição (debounce)
  document.getElementById('lancFiltroBusca')?.addEventListener('input', debounce(e => {
    e.stopPropagation();
    lancFiltro.busca = e.target.value;
    _lancPage = 1;
    _atualizarBadgeFiltros();
    const c = _contaAtualFiltro(); if (c) renderLancamentos(c);
  }, 200));

  // Ordenação
  document.getElementById('lancFiltroOrdem')?.addEventListener('change', e => {
    lancFiltro.ordem = e.target.value;
    _lancPage = 1;
    const c = _contaAtualFiltro(); if (c) renderLancamentos(c);
  });

  // ── Atalhos de período ────────────────────────────────────────────────
  document.querySelectorAll('.lanc-atalho').forEach(btn => {
    btn.addEventListener('click', () => {
      const periodo = btn.dataset.periodo;
      const hoje = new Date();
      let dtI, dtF;
      if (periodo === 'mes-atual') {
        dtI = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        dtF = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      } else if (periodo === 'mes-anterior') {
        dtI = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        dtF = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      } else if (periodo === 'ano-atual') {
        dtI = new Date(hoje.getFullYear(), 0, 1);
        dtF = new Date(hoje.getFullYear(), 11, 31);
      }
      const fmt = d => d.toISOString().split('T')[0];
      lancFiltro.dtI = fmt(dtI);
      lancFiltro.dtF = fmt(dtF);
      const iEl = document.getElementById('lancFiltroDtI');
      const fEl = document.getElementById('lancFiltroDtF');
      if (iEl) iEl.value = lancFiltro.dtI;
      if (fEl) fEl.value = lancFiltro.dtF;
      // highlight botão ativo
      document.querySelectorAll('.lanc-atalho').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _lancPage = 1;
      _atualizarBadgeFiltros();
      const c = _contaAtualFiltro(); if (c) renderLancamentos(c);
    });
  });

  // ── Busca em tempo real (debounce) ──
  if (inputBusca) {
    inputBusca.addEventListener('input', debounce(() => {
      treeState.searchQuery = inputBusca.value;
      if (treeState.searchQuery) {
        // Expande tudo para mostrar resultados
        if (repo.root) coletarTodosIds(repo.root).forEach(id => treeState.expanded.add(id));
      }
      renderTree();
    }, 250));
  }

  if (btnLimparBusca) {
    btnLimparBusca.addEventListener('click', () => {
      inputBusca.value = '';
      treeState.searchQuery = '';
      treeState.expanded.clear();
      renderTree();
      inputBusca.focus();
    });
  }

  // ── Atalhos de teclado globais ──
  document.addEventListener('keydown', (e) => {
    // Ignorar quando foco estiver em input/textarea
    const tag = document.activeElement?.tagName;
    const emInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Undo/redo keyboard shortcuts removed
    // Ctrl+F — Foco na busca
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault(); inputBusca?.focus(); inputBusca?.select(); return;
    }

    if (emInput) return;

    // F2 — Renomear conta selecionada
    if (e.key === 'F2') { e.preventDefault(); if (authCan('renameConta')) abrirModalRenomear(); return; }
    // Delete — Remover conta selecionada
    if (e.key === 'Delete') { e.preventDefault(); if (authCan('removeConta')) removerConta(); return; }
  // Insert — Abrir modal NOVO (substitui o campo rápido antigo)
  if (e.key === 'Insert') { e.preventDefault(); abrirModalNovo(); return; }

    // Setas: navegar na árvore
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navegarArvore(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    // ArrowRight: se a conta selecionada for um grupo/container, abre; se já aberto, vai para primeiro filho
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const id = treeState.selectedId;
      if (!id) return;
      const conta = repo.findById(id);
      if (!conta) return;
      const isContainer = conta.hasChildren || (!!conta.parent && conta.parent.isRoot);
      if (!isContainer) return;
      // Se não está expandido, expande
      if (!treeState.expanded.has(id)) {
        treeState.expanded.add(id);
        renderTree();
        // mantém seleção na mesma conta (re-render mantém row)
      } else {
        // já expandido: seleciona primeiro filho visível, se houver
        const firstChild = conta.firstChild;
        if (firstChild) selectConta(firstChild.id);
      }
      return;
    }

    // ArrowLeft: se a conta estiver expandida, fecha; senão seleciona o pai (se houver e não for root)
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const id = treeState.selectedId;
      if (!id) return;
      const conta = repo.findById(id);
      if (!conta) return;
      if (treeState.expanded.has(id)) {
        treeState.expanded.delete(id);
        renderTree();
        return;
      }
      if (conta.parent && !conta.parent.isRoot) {
        selectConta(conta.parent.id);
      } else if (conta.parent && conta.parent.isRoot) {
        // se o pai é root (grupo de primeiro nível), seleciona o pai também
        selectConta(conta.parent.id);
      }
      return;
    }
  });

  // Modal renomear
  btnConfirmarRenomear.addEventListener('click', confirmarRenomear);
  btnCancelarRenomear.addEventListener('click',  () => { modalRenomear.style.display = 'none'; });
  btnFecharRenomear.addEventListener('click',    () => { modalRenomear.style.display = 'none'; });
  inputRenomear.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  confirmarRenomear();
    if (e.key === 'Escape') modalRenomear.style.display = 'none';
  });

  // Fechar modal clicando fora
  modalRenomear.addEventListener('click', (e) => {
    if (e.target === modalRenomear) modalRenomear.style.display = 'none';
  });

  // ── Modal Confirmação genérica ──────────────────────────────────────────
  document.getElementById('btnConfirmCancel')?.addEventListener('click', () => {
    document.getElementById('modalConfirm').style.display = 'none';
  });
  document.getElementById('btnConfirmClose')?.addEventListener('click', () => {
    document.getElementById('modalConfirm').style.display = 'none';
  });
  document.getElementById('modalConfirm')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalConfirm'))
      document.getElementById('modalConfirm').style.display = 'none';
  });

  // ── Exportar CSV ────────────────────────────────────────────────────────
  document.getElementById('btnExportCSV')?.addEventListener('click', () => {
    const conta = _contaAtualFiltro();
    if (!conta) { showToast('Selecione uma conta primeiro.', 'warning'); return; }
    const lista = _lancamentosFiltrados(conta);
    exportarCSVLancamentos(lista, conta.nome);
    showToast(`${lista.length} lançamento(s) exportado(s).`, 'success');
  });

  // ── Splitter redimensionável ─────────────────────────────────────────────
  const splitter  = document.getElementById('panelSplitter');
  const panelTree = document.querySelector('.panel-tree');
  if (splitter && panelTree) {
    let isDragging = false;
    splitter.addEventListener('mousedown', () => {
      isDragging = true;
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      splitter.classList.add('dragging');
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const w = Math.max(220, Math.min(560, e.clientX));
      panelTree.style.width = w + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      splitter.classList.remove('dragging');
      localStorage.setItem('plano_splitter_w', panelTree.offsetWidth);
    });
    const savedW = localStorage.getItem('plano_splitter_w');
    if (savedW) panelTree.style.width = savedW + 'px';
  }
});
