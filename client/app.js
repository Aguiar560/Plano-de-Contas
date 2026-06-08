/**
* app.js — Modelo de dados do Plano de Contas
 * Espelha a entidade TContaGerencial do Delphi/Aurelius
 */

'use strict';

// ── Modelo de Conta Gerencial ──────────────────────────────────────────────
let _nextId     = 1;
let _nextLancId = 1;

// ── Modelo de Lançamento ───────────────────────────────────────────────────
class Lancamento {
  /**
   * @param {'credito'|'debito'} tipo
   *   Crédito = entrada de valor (receita / redução de despesa)
   *   Débito  = saída de valor  (despesa / redução de receita)
   * @param {number}  valor      Sempre positivo; o tipo define o sinal contábil
   * @param {string}  descricao  Histórico / complemento
   * @param {string}  [data]     ISO date string; padrão: hoje
   */
  constructor(tipo, valor, descricao, data = null) {
    this.id        = _nextLancId++;
    this.tipo      = tipo;        // 'credito' | 'debito'
    this.valor     = valor;       // sempre > 0
    this.descricao = descricao.trim();
    this.data      = data || new Date().toISOString().split('T')[0];
  }
}

class ContaGerencial {
  constructor(nome, id = null) {
    this.id          = id ?? _nextId++;
    this.nome        = nome.toUpperCase().trim();
    this.parent      = null;
    this.firstChild  = null;
    this.lastChild   = null;
    this.nextSibling = null;
    // Orçamento anual/mensal por conta (padrão contábil: orçado vs realizado)
    this.orcamento   = 0;
    // Natureza: 'resultado' (receita/despesa) ou 'patrimonial' (ativo/passivo)
    this.natureza    = 'resultado';
    // Simulação de lançamentos (para relatório)
    this.lancamentos = [];
  }

  /** Adiciona subconta (igual a TContaGerencial.addChild) */
  addChild(conta) {
    conta.parent = this;
    if (!this.firstChild) this.firstChild = conta;
    if (this.lastChild) this.lastChild.nextSibling = conta;
    this.lastChild = conta;
  }

  /** Insere src antes de ref (ambos filhos deste nó) */
  insertChildBefore(src, ref) {
    src.parent = this;
    src.nextSibling = null;
    if (!this.firstChild || this.firstChild.id === ref.id) {
      src.nextSibling = this.firstChild;
      this.firstChild = src;
      if (!this.lastChild) this.lastChild = src;
    } else {
      let prev = this.firstChild;
      while (prev.nextSibling && prev.nextSibling.id !== ref.id) prev = prev.nextSibling;
      src.nextSibling = prev.nextSibling;
      prev.nextSibling = src;
      if (!src.nextSibling) this.lastChild = src;
    }
  }

  /** Insere src depois de ref (ambos filhos deste nó) */
  insertChildAfter(src, ref) {
    src.parent = this;
    src.nextSibling = ref.nextSibling;
    ref.nextSibling = src;
    if (!src.nextSibling) this.lastChild = src;
  }

  /** Remove subconta (igual a TContaGerencial.removeChild) */
  removeChild(conta) {
    if (!this.firstChild) return;

    if (this.firstChild.id === conta.id) {
      this.firstChild = conta.nextSibling;
      if (!this.firstChild) this.lastChild = null;
      // só limpa quando realmente removeu
      conta.parent = null;
      conta.nextSibling = null;
    } else {
      let prev = this.firstChild;
      while (prev && prev.nextSibling) {
        if (prev.nextSibling.id === conta.id) {
          prev.nextSibling = conta.nextSibling;
          if (!prev.nextSibling) this.lastChild = prev;
          // só limpa quando realmente removeu
          conta.parent = null;
          conta.nextSibling = null;
          break;
        }
        prev = prev.nextSibling;
      }
    }
  }

  /** Lista filhos diretos como array */
  get children() {
    const arr = [];
    let c = this.firstChild;
    while (c) { arr.push(c); c = c.nextSibling; }
    return arr;
  }

  /** Verifica se possui subcontas */
  get hasChildren() {
    return !!this.firstChild;
  }

  /** Conta total de descendentes */
  get totalDescendants() {
    let count = 0;
    let c = this.firstChild;
    while (c) {
      count += 1 + c.totalDescendants;
      c = c.nextSibling;
    }
    return count;
  }

  /** Saldo somado dos lançamentos */
  get saldo() {
    return this.lancamentos.reduce((s, l) => s + l.valor, 0);
  }

  /** Verifica se é raiz protegida */
  get isRoot() {
    // Uma conta é raiz quando não tem parent (ex: PLANO)
    return this.parent === null;
  }

  /** Tipo da conta (Entrada/Saída) determinado pela raiz */
  get tipo() {
    // Derivar tipo ('Entrada' | 'Saída' | '-') a partir do ancestral de primeiro nível.
    try {
      let c = this;
      // subir até o filho direto do root
      while (c && c.parent && !c.parent.isRoot) c = c.parent;
      if (c && c.parent && c.parent.isRoot) {
        const n = (c.nome || '').toUpperCase();
        if (n.includes('ENTRAD')) return 'Entrada';
        if (n.includes('SAID'))   return 'Saída';
      }
    } catch(e) {}
    return '-';
  }

  /** Caminho completo (breadcrumb) */
  get caminho() {
    const partes = [];
    let c = this;
    while (c) {
      // pular nomes vazios (ex: root anônimo criado para ENTRADAS/SAIDAS)
      if (c.nome && c.nome.trim() !== '') partes.unshift(c.nome);
      c = c.parent;
    }
    return partes.join(' › ');
  }

  /** Nível na hierarquia (raiz = 1) */
  get nivel() {
    let n = 1, c = this;
    while (c.parent) { n++; c = c.parent; }
    return n;
  }

  /**
   * Código contábil hierárquico (ex: 1, 1.1, 1.2, 1.1.3)
   * Padrão do Plano de Contas brasileiro (NBC TG / CFC)
   */
  get codigo() {
    // Código hierárquico baseado exclusivamente na posição entre irmãos,
    // sem segmentos reservados para ENTRADAS/SAIDAS (eles não existem mais).
    const partes = [];
    let c = this;
    while (c.parent) {
      let pos = 1, irmao = c.parent.firstChild;
      while (irmao && irmao.id !== c.id) { pos++; irmao = irmao.nextSibling; }
      partes.unshift(String(pos));
      c = c.parent;
    }
    return partes.join('.');
  }
}

// ── Repositório em memória (persiste no localStorage) ────────────────────
const STORAGE_KEY      = 'plano_gerencial_contas_v2';
const STORAGE_KEY_PREV = STORAGE_KEY + '_prev';   // backup rolling de 1 geração
const SCHEMA_VERSION   = 2;                        // incrementar ao mudar estrutura

class PlanoContasRepository {
  constructor() {
    // Novo modelo: um root único (ex: 'PLANO') que contém todos os grupos como filhos.
    this._root     = null;
    // (single root model)
  }

  /** Inicializa o plano de contas — cria raízes se não existirem */
  init() {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        _nextId = data.nextId || 1;
        // Novo formato: contém 'root'
        if (data.root) {
          // Novo formato: contém 'root' — carregar diretamente
            this._root = this._fromJSON(data.root, null);
            // Se o root salvo for um nó literal chamado 'PLANO', migrar removendo esse nível
            // e promovendo seus filhos para um root anônimo (sem nome) — isso remove o
            // nível 'PLANO' da UX enquanto preserva a hierarquia interna.
            try {
              if (this._root && (this._root.nome || '').toUpperCase() === 'PLANO') {
                const newRoot = new ContaGerencial('');
                // mover filhos do antigo root para o novo root
                let c = this._root.firstChild;
                while (c) {
                  const next = c.nextSibling;
                  // desconectar do antigo pai
                  c.parent = null;
                  c.nextSibling = null;
                  newRoot.addChild(c);
                  c = next;
                }
                this._root = newRoot;
                // persistir migração automaticamente
                try { this.salvar(); } catch(e) { /* não bloquear */ }
              } else {
                // Persistir para garantir consistência com o novo formato
                try { this.salvar(); } catch(e) { /* não bloquear */ }
              }
            } catch(e) { /* não bloquear migração */ }
            return;
        }
        // Formato antigo removido — suportamos apenas o novo formato com 'root'
      } catch (e) {
        console.warn('Erro ao carregar dados salvos, reiniciando:', e);
        // Preservar dado corrompido para diagnóstico antes de descartar
        try {
          const raw = sessionStorage.getItem(STORAGE_KEY);
          if (raw) {
            sessionStorage.setItem(STORAGE_KEY + '_corrupted_' + Date.now(), raw);
            sessionStorage.removeItem(STORAGE_KEY);
            console.warn('[repo] Dado corrompido salvo em _corrupted_<timestamp> para diagnóstico.');
          }
        } catch(e2) { /* quota — ignorar */ }
      }
    }
    this._criarEstruturaPadrao();
  }

  _criarEstruturaPadrao() {
    // Estrutura mínima: apenas ENTRADAS e SAIDAS como raízes.
    // O restante da hierarquia vem do banco de dados via GET /api/contas.
    this._root = new ContaGerencial('');
    const entradasRoot = new ContaGerencial('ENTRADAS');
    const saidasRoot   = new ContaGerencial('SAIDAS');
    this._root.addChild(entradasRoot);
    this._root.addChild(saidasRoot);
    this.salvar();
  }

  // Acesso ao root principal do plano
  get root()     { return this._root; }

  /**
   * Carrega a árvore de contas do banco.
   * CQRS: duas chamadas paralelas — GET /api/contas (estrutura) e
   * GET /api/lancamentos?ano=XXXX (dados). Lançamentos são distribuídos
   * por conta_id após construção da árvore.
   * Retorna true se bem sucedido, false se falhar (modo offline).
   */
  async carregarDoBanco(ano) {
    const anoAlvo = ano || new Date().getFullYear();
    try {
      const base = (typeof API_BASE !== 'undefined') ? API_BASE : ((location && location.protocol === 'file:') ? 'http://localhost:3001' : '');

      // Duas chamadas paralelas: estrutura + lançamentos do ano
      const [respContas, respLancs] = await Promise.all([
        fetch(base + '/api/contas', { credentials: 'include' }),
        fetch(base + '/api/lancamentos?ano=' + anoAlvo, { credentials: 'include' }),
      ]);
      if (!respContas.ok) return false;
      const { ok, contas } = await respContas.json();
      if (!ok || !contas) return false;

      // Lançamentos indexados por conta_id (falha não bloqueia estrutura)
      const lancsPorContaId = {};
      if (respLancs.ok) {
        try {
          const lancData = await respLancs.json();
          if (lancData.ok && Array.isArray(lancData.lancamentos)) {
            for (const l of lancData.lancamentos) {
              if (!lancsPorContaId[l.conta_id]) lancsPorContaId[l.conta_id] = [];
              lancsPorContaId[l.conta_id].push(l);
            }
          }
        } catch(e) { /* lançamentos indisponíveis — carrega estrutura apenas */ }
      }

      // Preserva itens e fornecedor_id do estado local (não persistidos no banco)
      const savedLocals = {};
      if (this._root) {
        const _coletar = (c) => {
          for (const l of c.lancamentos) {
            if (l.db_id) {
              savedLocals[l.db_id] = {
                itens: (l.itens && l.itens.length) ? l.itens : null,
                fornecedor_id: l.fornecedor_id || null,
              };
            }
          }
          let ch = c.firstChild;
          while (ch) { _coletar(ch); ch = ch.nextSibling; }
        };
        _coletar(this._root);
      }

      // Reconstruir árvore; conta.db_id = PK do banco para match com lancamentos
      const novoRoot = new ContaGerencial('');
      _nextId = 1;

      const _construir = (nos, pai) => {
        nos.forEach(n => {
          const conta = new ContaGerencial(n.nome);
          conta.db_id          = n.id;      // PK do banco — usado para distribuir lancamentos
          conta.codigo_banco   = n.codigo;
          conta.natureza_banco = n.natureza;
          conta.orcamento      = parseFloat(n.orcamento) || 0;

          // Atribuir lançamentos desta conta usando conta_id como chave
          conta.lancamentos = (lancsPorContaId[n.id] || []).map(l => {
            const lanc = new Lancamento(l.tipo, parseFloat(l.valor), l.descricao || '', l.data);
            const _saved = (l.id && savedLocals[l.id]) || {};
            lanc.db_id         = l.id;
            lanc.itens         = _saved.itens || l.itens || null;
            lanc.fornecedor_id = _saved.fornecedor_id || l.fornecedor_id || null;
            return lanc;
          });

          if (pai) pai.addChild(conta);
          else novoRoot.addChild(conta);
          if (n.filhos && n.filhos.length > 0) _construir(n.filhos, conta);
        });
      };
      _construir(contas, null);

      this._root = novoRoot;
      this.salvar();
      window.dispatchEvent(new Event('plano:loaded'));
      if (typeof window.fornRepo !== 'undefined' && typeof window.fornRepo.sincronizar === 'function') {
        window.fornRepo.sincronizar();
      }
      return true;
    } catch(e) {
      console.warn('[repo] Falha ao carregar do banco, usando localStorage:', e.message);
      return false;
    }
  }

  findById(id) {
    if (!this._root) return null;
    return this._buscarRecursivo(this._root, id);
  }

  findByNome(nome) {
    const n = nome.toUpperCase().trim();
    // procura em toda a árvore do root (compatível com ambos formatos)
    if (this._root && this._root.nome === n) return this._root;
    return this._buscarPorNome(this._root, n);
  }

  _buscarRecursivo(conta, id) {
    if (!conta) return null;
    if (conta.id === id) return conta;
    let c = conta.firstChild;
    while (c) {
      const r = this._buscarRecursivo(c, id);
      if (r) return r;
      c = c.nextSibling;
    }
    return null;
  }

  _buscarPorNome(conta, nome) {
    if (!conta) return null;
    if (conta.nome === nome) return conta;
    let c = conta.firstChild;
    while (c) {
      const r = this._buscarPorNome(c, nome);
      if (r) return r;
      c = c.nextSibling;
    }
    return null;
  }

  /** Remove conta de toda a hierarquia */
  removerConta(conta) {
    if (conta.isRoot) return false;
    // Remove de qualquer pai que a contenha
    if (this._root) this._removerDeHierarquia(this._root, conta);
    this.salvar();
    return true;
  }

  _removerDeHierarquia(raiz, alvo) {
    if (!raiz) return;
    raiz.removeChild(alvo);
    let c = raiz.firstChild;
    while (c) {
      this._removerDeHierarquia(c, alvo);
      c = c.nextSibling;
    }
  }

  /** Conta total de contas */
  get totalContas() {
    if (!this._root) return 0;
    // número de contas NÃO incluindo o root PLANO
    return this._root.totalDescendants;
  }

  /** Serialização para JSON */
  _toJSON(conta) {
    if (!conta) return null;
    return {
      id:          conta.id,
      nome:        conta.nome,
      orcamento:   conta.orcamento,
      natureza:    conta.natureza,
      codigo_banco: conta.codigo_banco || null,
      lancamentos: conta.lancamentos.map(l => ({
        id: l.id, tipo: l.tipo, valor: l.valor,
        descricao: l.descricao, data: l.data,
        db_id: l.db_id || null,
        itens: l.itens && l.itens.length ? l.itens : null,
        fornecedor_id: l.fornecedor_id || null,
      })),
      children:  conta.children.map(c => this._toJSON(c))
    };
  }

  _fromJSON(data, parent) {
    if (!data) return null;
    const conta = new ContaGerencial(data.nome, data.id);
    conta.parent        = parent;
    conta.orcamento     = data.orcamento  || 0;
    conta.natureza      = data.natureza   || 'resultado';
    conta.codigo_banco  = data.codigo_banco || null;
    conta.lancamentos = (data.lancamentos || []).filter(l => l.db_id).map(l => {
      const lanc = new Lancamento(l.tipo, l.valor, l.descricao || '', l.data);
      lanc.id           = l.id;
      lanc.db_id        = l.db_id;
      lanc.itens        = l.itens || null;
      lanc.fornecedor_id = l.fornecedor_id || null;
      if (_nextLancId <= l.id) _nextLancId = l.id + 1;
      return lanc;
    });
    if (_nextId <= data.id) _nextId = data.id + 1;
    for (const ch of (data.children || [])) {
      const filho = this._fromJSON(ch, conta);
      if (conta.firstChild === null) conta.firstChild = filho;
      if (conta.lastChild)          conta.lastChild.nextSibling = filho;
      conta.lastChild = filho;
    }
    return conta;
  }

  // ── Lançamentos ────────────────────────────────────────────────────────

  /**
   * Insere um lançamento numa conta e salva.
   * Retorna alertas de orçamento se houver.
   */
  inserirLancamento(conta, lancamento) {
    conta.lancamentos.push(lancamento);
    this.salvar();
    // notify header/others that saldo mudou
    try {
      // Debug: opcionalmente logar valores antes do dispatch
      // saldo update dispatched
      window.dispatchEvent(new Event('saldo:update'));
    } catch(e){}
    return this.alertaOrcamento(conta);
  }

  /** Remove um lançamento pelo id. */
  removerLancamento(conta, lancId) {
    conta.lancamentos = conta.lancamentos.filter(l => l.id !== lancId);
    this.salvar();
    try {
      // saldo update dispatched
      window.dispatchEvent(new Event('saldo:update'));
    } catch(e){}
  }

  /**
   * Saldo apenas dos lançamentos DIRETOS da conta (sem filhos).
   * Crédito = positivo · Débito = negativo
   */
  saldoDireto(conta) {
    return conta.lancamentos.reduce((s, l) => {
      return s + (l.tipo === 'credito' ? l.valor : -l.valor);
    }, 0);
  }

  /**
   * Saldo acumulado: conta + todos os descendentes.
   * Usado para comparar com o orçamento.
   */
  saldoAcumulado(conta) {
    let total = this.saldoDireto(conta);
    let c = conta.firstChild;
    while (c) { total += this.saldoAcumulado(c); c = c.nextSibling; }
    return total;
  }

  /**
   * Valor realizado para comparação com orçamento — sempre positivo.
   * Soma l.valor independente do tipo (crédito/débito), porque o orçamento
   * é sempre positivo e representa o teto de gasto/receita da conta.
   */
  realizadoOrcamento(conta) {
    function somarRecursivo(c) {
      let v = c.lancamentos.reduce((s, l) => s + l.valor, 0);
      let f = c.firstChild;
      while (f) { v += somarRecursivo(f); f = f.nextSibling; }
      return v;
    }
    return somarRecursivo(conta);
  }

  /**
   * Percentual do orçamento utilizado (0–∞).
   * Retorna null se orçamento = 0.
   */
  percentualOrcamento(conta) {
    if (!conta.orcamento || conta.orcamento <= 0) return null;
    return this.realizadoOrcamento(conta) / conta.orcamento * 100;
  }

  /**
   * Verifica situação do orçamento.
   * Retorna: 'ok' | 'atencao' (>80%) | 'excedido' (>100%) | null (sem orçamento)
   */
  alertaOrcamento(conta) {
    const pct = this.percentualOrcamento(conta);
    if (pct === null) return null;
    if (pct > 100) return 'excedido';
    if (pct > 80)  return 'atencao';
    return 'ok';
  }

  salvar() {
    // Backup rolling: preservar geração anterior antes de sobrescrever
    try {
      const current = sessionStorage.getItem(STORAGE_KEY);
      if (current) sessionStorage.setItem(STORAGE_KEY_PREV, current);
    } catch(e) { /* quota excedida — não bloquear */ }

    const data = { schemaVersion: SCHEMA_VERSION, nextId: _nextId, savedAt: Date.now() };
    // Persistir somente o root no novo formato
    if (this._root) data.root = this._toJSON(this._root);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // notify interested UI parts that data changed
    try {
      // saldo update dispatched
      window.dispatchEvent(new Event('saldo:update'));
    } catch(e){}
  }

  /** Exporta para XML (igual ao Button2Click do Delphi) */
  exportarXML() {
    const xmlLines = ['<?xml version="1.0" encoding="utf-8"?>', '<contas>'];
    if (this._root) {
      let c = this._root.firstChild;
      while (c) { this._contaParaXML(c, xmlLines, 1); c = c.nextSibling; }
    }
    xmlLines.push('</contas>');
    return xmlLines.join('\n');
  }

  _contaParaXML(conta, lines, depth) {
    const indent  = '  '.repeat(depth);
    const tag     = conta.nome.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '_');
    const hasKids = conta.hasChildren;
    if (hasKids) {
      lines.push(`${indent}<${tag} nome="${this._escapeXML(conta.nome)}">`);
      let c = conta.firstChild;
      while (c) { this._contaParaXML(c, lines, depth + 1); c = c.nextSibling; }
      lines.push(`${indent}</${tag}>`);
    } else {
      lines.push(`${indent}<${tag} nome="${this._escapeXML(conta.nome)}"/>`);
    }
  }

  _escapeXML(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

// ── Instância global ──────────────────────────────────────────────────────
const repo = new PlanoContasRepository();
// Algumas partes do código (ex: login.js) acessam window.repo — garantir compatibilidade
try {
  window.repo = repo;
  // Expõe classes para testes automatizados (class declarations não são props de window)
  window.Lancamento            = Lancamento;
  window.ContaGerencial        = ContaGerencial;
  window.PlanoContasRepository = PlanoContasRepository;
} catch(e) { /* ignore in restricted contexts */ }

// ── Utilitários de UI ─────────────────────────────────────────────────────
/**
 * Debounce: atrasa a execução da função até que pare de ser chamada.
 * @param {Function} fn
 * @param {number}   delay ms
 */
function debounce(fn, delay = 280) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Modal de confirmação personalizado.
 * Substitui window.confirm() com visual consistente e focus trap.
 * @param {string}   titulo
 * @param {string}   msg
 * @param {Function} onConfirm  Chamado ao clicar "Confirmar"
 * @param {object}   [opts]
 * @param {string}   [opts.confirmLabel='Confirmar']
 * @param {string}   [opts.confirmClass='btn-danger']
 */
function confirmar(titulo, msg, onConfirm, opts = {}) {
  const overlay  = document.getElementById('modalConfirm');
  const titleEl  = document.getElementById('confirmTitle');
  const msgEl    = document.getElementById('confirmMsg');
  const btnOk    = document.getElementById('btnConfirmOk');
  const btnCancel= document.getElementById('btnConfirmCancel');
  const btnClose = document.getElementById('btnConfirmClose');
  if (!overlay) { if (window.confirm(msg)) onConfirm(); return; }

  titleEl.textContent  = titulo;
  msgEl.textContent    = msg;
  btnOk.textContent    = opts.confirmLabel || 'Confirmar';
  btnOk.className      = `btn ${opts.confirmClass || 'btn-danger'}`;
  btnCancel.textContent = opts.cancelLabel || 'Cancelar';

  overlay.style.display = 'flex';
  trapFocus(overlay);
  setTimeout(() => btnOk.focus(), 80);

  function fechar() {
    overlay.style.display = 'none';
    btnOk.replaceWith(btnOk.cloneNode(true));
    btnCancel.replaceWith(btnCancel.cloneNode(true));
    btnClose.replaceWith(btnClose.cloneNode(true));
    // Re-bind fechar/cancelar
    document.getElementById('btnConfirmCancel').addEventListener('click', () => document.getElementById('modalConfirm').style.display = 'none');
    document.getElementById('btnConfirmClose').addEventListener('click',  () => document.getElementById('modalConfirm').style.display = 'none');
  }

  // Registra confirm
  document.getElementById('btnConfirmOk').addEventListener('click', () => {
    fechar();
    onConfirm();
  });

  document.getElementById('btnConfirmCancel').addEventListener('click', () => {
    fechar();
    if (opts.onCancel) opts.onCancel();
  });

  overlay.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { fechar(); overlay.removeEventListener('keydown', escHandler); }
  }, { once: true });
}

/**
 * Focus Trap: mantém o foco dentro do elemento enquanto está visível.
 * @param {HTMLElement} container
 */
function trapFocus(container) {
  const focusables = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];

  function handler(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  }

  // Remove handler anterior se houver
  container._trapHandler && container.removeEventListener('keydown', container._trapHandler);
  container._trapHandler = handler;
  container.addEventListener('keydown', handler);
}

/**
 * Exporta array de lançamentos para CSV e dispara download.
 * @param {Lancamento[]} lancamentos
 * @param {string}       nomeConta
 */
function exportarCSVLancamentos(lancamentos, nomeConta) {
  const header = ['ID', 'Data', 'Tipo', 'Valor', 'Descricao'];
  const rows   = lancamentos.map(l => [
    l.id,
    l.data,
    l.tipo === 'credito' ? 'Crédito' : 'Débito',
    l.valor.toFixed(2).replace('.', ','),
    `"${(l.descricao || '').replace(/"/g, '""')}"`
  ]);

  const csv = [header, ...rows].map(r => r.join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `lancamentos_${nomeConta.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Utilitários de data ───────────────────────────────────────────────────
/**
 * Converte string 'YYYY-MM-DD' em objeto Date no horário local (evita shift de timezone).
 * Usar sempre que precisar fazer new Date() a partir de string ISO de data.
 */
function parseLocalDate(str) {
  if (!str || typeof str !== 'string') return new Date(NaN);
  return new Date(str + 'T12:00:00');
}

/**
 * Formata objeto Date (ou string YYYY-MM-DD) para exibição em pt-BR: "01/05/2026".
 */
function formatLocalDate(dateOrStr) {
  const d = typeof dateOrStr === 'string' ? parseLocalDate(dateOrStr) : dateOrStr;
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

// ── Loading overlay ───────────────────────────────────────────────────────
function showSpinner(msg = 'Carregando…') {
  const overlay = document.getElementById('loadingOverlay');
  const label   = document.getElementById('loadingLabel');
  if (!overlay) return;
  if (label) label.textContent = msg;
  overlay.classList.remove('hidden');
}

function hideSpinner() {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  // remover do DOM após a transição para não bloquear eventos
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 300);
}

function showToast(msg, tipo = 'success') {  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  const icons = {
    success: '✓', error: '✕', info: 'ℹ', warning: '⚠'
  };
  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '16px';
  iconSpan.textContent = icons[tipo] || 'ℹ';
  const msgSpan = document.createElement('span');
  msgSpan.textContent = String(msg);
  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all .3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function formatMoeda(v) {
  return 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ── Inicialização ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  repo.init();
  // sinaliza aos listeners que o repositório foi inicializado
  try { window.dispatchEvent(new Event('repo:ready')); } catch(e){}
  // notifica mudanças de saldo para atualizar o header (caso tenha sido renderizado antes)
  try { window.dispatchEvent(new Event('saldo:update')); } catch(e){}
});
