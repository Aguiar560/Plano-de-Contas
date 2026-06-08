/**
 * onboarding.js — Wizard de primeiro acesso
 * Exibe 3 passos após login quando o plano de contas está vazio.
 */
'use strict';

const ONBOARDING_KEY = 'plano_onboarding_v1';

const STARTER_TEMPLATES = [
  {
    id: 'servicos',
    label: 'Empresa de Serviços',
    desc: 'Consultorias, agências, freelas — foco em receitas de serviço e despesas operacionais.',
    contas: [
      { nome: 'RECEITAS', nat: 'entrada', filhos: [
        { nome: 'RECEITA DE SERVIÇOS', nat: 'entrada' },
        { nome: 'OUTRAS RECEITAS', nat: 'entrada' },
      ]},
      { nome: 'DESPESAS OPERACIONAIS', nat: 'saida', filhos: [
        { nome: 'PESSOAL', nat: 'saida' },
        { nome: 'INFRAESTRUTURA', nat: 'saida' },
        { nome: 'MARKETING', nat: 'saida' },
        { nome: 'ADMINISTRATIVO', nat: 'saida' },
      ]},
      { nome: 'IMPOSTOS E TRIBUTOS', nat: 'saida' },
    ]
  },
  {
    id: 'comercio',
    label: 'Comércio / Varejo',
    desc: 'Lojas físicas ou e-commerce — inclui CMV, estoque e custos de venda.',
    contas: [
      { nome: 'RECEITAS', nat: 'entrada', filhos: [
        { nome: 'VENDA DE MERCADORIAS', nat: 'entrada' },
        { nome: 'OUTRAS RECEITAS', nat: 'entrada' },
      ]},
      { nome: 'CUSTO DAS MERCADORIAS', nat: 'saida', filhos: [
        { nome: 'COMPRA DE MERCADORIAS', nat: 'saida' },
        { nome: 'FRETE E LOGÍSTICA', nat: 'saida' },
      ]},
      { nome: 'DESPESAS OPERACIONAIS', nat: 'saida', filhos: [
        { nome: 'PESSOAL', nat: 'saida' },
        { nome: 'ALUGUEL E OCUPAÇÃO', nat: 'saida' },
        { nome: 'MARKETING', nat: 'saida' },
      ]},
      { nome: 'IMPOSTOS E TRIBUTOS', nat: 'saida' },
    ]
  },
  {
    id: 'vazio',
    label: 'Começar do zero',
    desc: 'Sem contas pré-criadas. Você monta a estrutura do zero conforme necessário.',
    contas: []
  }
];

let _selectedTemplate = 'servicos';
let _onbStep = 1;

function _onbOverlay() { return document.getElementById('overlayOnboarding'); }

function _onbShow(step) {
  _onbStep = step;
  const overlay = _onbOverlay();
  if (!overlay) return;

  overlay.querySelectorAll('.onb-step').forEach(el => {
    el.style.display = (el.dataset.step == step) ? '' : 'none';
  });

  overlay.querySelectorAll('.onb-dot').forEach(dot => {
    dot.classList.toggle('active', +dot.dataset.dot === step);
  });

  overlay.style.display = 'flex';
}

function _onbClose() {
  const overlay = _onbOverlay();
  if (overlay) overlay.style.display = 'none';
  localStorage.setItem(ONBOARDING_KEY, '1');
}

async function _onbCriarTemplate() {
  const tmpl = STARTER_TEMPLATES.find(t => t.id === _selectedTemplate);
  if (!tmpl || !tmpl.contas.length) return;

  const base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
  const headers = { 'Content-Type': 'application/json' };
  try {
    const ses = JSON.parse(sessionStorage.getItem('plano_auth_session_v1') || '{}');
    if (ses.token) headers['Authorization'] = 'Bearer ' + ses.token;
  } catch(e) {}

  async function criarConta(nome, nat, parentCodigo) {
    try {
      const resp = await fetch(base + '/api/contas', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ nome, natureza: nat, parent_codigo: parentCodigo || null })
      });
      if (!resp.ok) return null;
      const d = await resp.json();
      return d.ok ? d.conta : null;
    } catch(e) { return null; }
  }

  for (const c of tmpl.contas) {
    const pai = await criarConta(c.nome, c.nat, null);
    if (pai && c.filhos) {
      for (const f of c.filhos) {
        await criarConta(f.nome, f.nat, pai.codigo);
      }
    }
  }
}

async function _onbFinalizar() {
  const btn = document.getElementById('btnOnbFinalizar');
  if (btn) { btn.disabled = true; btn.textContent = 'Criando…'; }

  const empresa = (document.getElementById('onbEmpresaNome')?.value || '').trim();
  if (empresa) {
    try { localStorage.setItem('plano_branding_company', empresa); } catch(e) {}
    if (typeof applyBranding === 'function') applyBranding();
  }

  try { await _onbCriarTemplate(); } catch(e) { /* fecha overlay mesmo com erro */ }

  _onbClose();

  // Recarregar a árvore com as contas criadas
  try {
    if (typeof repo !== 'undefined' && typeof repo.carregarDoBanco === 'function' && typeof updateDashboard === 'function') {
      await repo.carregarDoBanco();
      if (typeof renderTree === 'function') renderTree();
      updateDashboard();
    }
  } catch(e) {}

  if (typeof showToast === 'function') showToast('Bem-vindo! Plano de contas configurado.', 'success');
}

function _onbRenderTemplates() {
  const container = document.getElementById('onbTemplateGrid');
  if (!container) return;
  container.innerHTML = STARTER_TEMPLATES.map(t => `
    <div class="onb-template-card ${t.id === _selectedTemplate ? 'selected' : ''}"
         data-tid="${t.id}" tabindex="0" role="button">
      <div class="onb-template-title">${t.label}</div>
      <div class="onb-template-desc">${t.desc}</div>
    </div>
  `).join('');

  container.querySelectorAll('.onb-template-card').forEach(card => {
    const select = () => {
      _selectedTemplate = card.dataset.tid;
      container.querySelectorAll('.onb-template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    };
    card.addEventListener('click', select);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') select(); });
  });
}

function initOnboarding() {
  // Já concluiu antes
  if (localStorage.getItem(ONBOARDING_KEY)) return;

  // Aguardar o app estar pronto e checar se o plano está vazio
  const _check = () => {
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    if (typeof repo === 'undefined') return;
    const contas = repo.listar ? repo.listar() : [];
    const temContas = contas && contas.length > 0;

    // Só mostra para admin/gerente com plano vazio
    if (temContas) { localStorage.setItem(ONBOARDING_KEY, '1'); return; }
    if (!auth.can('addConta')) return;

    _onbRenderTemplates();
    _onbShow(1);
  };

  // Aguarda o carregarDoBanco completar (evento customizado disparado em app.js)
  window.addEventListener('plano:loaded', _check, { once: true });
  // Fallback: checar após 2s caso evento não dispare
  const _fallback = setTimeout(_check, 2000);
  // Cancela o fallback se o evento disparar antes
  window.addEventListener('plano:loaded', () => clearTimeout(_fallback), { once: true });
}

// ── Wiring de botões ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnOnbProximo1')?.addEventListener('click', () => {
    _onbRenderTemplates();
    _onbShow(2);
  });
  document.getElementById('btnOnbVoltar2')?.addEventListener('click', () => _onbShow(1));
  document.getElementById('btnOnbProximo2')?.addEventListener('click', () => _onbShow(3));
  document.getElementById('btnOnbVoltar3')?.addEventListener('click', () => _onbShow(2));
  document.getElementById('btnOnbFinalizar')?.addEventListener('click', _onbFinalizar);
  document.getElementById('btnOnbPular')?.addEventListener('click', _onbClose);
});

window.initOnboarding = initOnboarding;
