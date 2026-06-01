/**
 * nav.js — Roteamento de views e integração da sidebar
 */
'use strict';

const NAV_VIEWS = {
  dashboard:    { title: 'Dashboard',              el: 'view-dashboard',    flex: false },
  fornecedores: { title: 'Fornecedores',           el: 'view-fornecedores', flex: false },
  plano:        { title: 'Plano de Contas',        el: 'view-plano',        flex: true  },
  recibos:      { title: 'Recibos de Autônomo',    el: 'view-recibos',      flex: false },
  relatorios:   { title: 'Relatórios',             el: 'view-relatorios',   flex: false },
  config:       { title: 'Configurações',          el: 'view-config',       flex: false },
};

let _currentView = 'dashboard';

function navigateTo(viewId) {
  const cfg = NAV_VIEWS[viewId];
  if (!cfg) return;

  // Hide all views
  document.querySelectorAll('.view, .view-flex').forEach(v => {
    v.classList.remove('active');
    v.style.display = 'none';
  });

  // Show target
  const el = document.getElementById(cfg.el);
  if (el) {
    el.classList.add('active');
    el.style.display = cfg.flex ? 'flex' : 'block';
  }

  // Update topbar title
  const title = document.getElementById('topbarTitle');
  if (title) title.textContent = cfg.title;

  // Update sidebar active state
  document.querySelectorAll('.sidebar-item[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });

  // Show/hide XML export and OFX import buttons for plano view
  const btnXML = document.getElementById('btnExportXML');
  if (btnXML) btnXML.style.display = viewId === 'plano' ? '' : 'none';
  const btnOFX = document.getElementById('btnAbrirImportOFX');
  if (btnOFX) btnOFX.style.display = viewId === 'plano' ? '' : 'none';

  _currentView = viewId;

  // Trigger view-specific refresh
  if (viewId === 'dashboard' && typeof updateDashboard === 'function') {
    updateDashboard();
  }
  if (viewId === 'fornecedores' && typeof refreshFornecedoresView === 'function') {
    refreshFornecedoresView();
  }
  if (viewId === 'recibos' && typeof initRecibosPage === 'function') {
    initRecibosPage();
  }
  if (viewId === 'config') {
    const { product, company } = _getBrandingValues();
    const inpE = document.getElementById('cfgEmpresaNome');
    const inpS = document.getElementById('cfgSistemaNome');
    if (inpE) { inpE.value = company; delete inpE.dataset.dirty; }
    if (inpS) { inpS.value = product; delete inpS.dataset.dirty; }
  }
}

// ── Sidebar navigation clicks ──────────────────────────────────────────
document.querySelectorAll('.sidebar-item[data-view]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.view));
});


// ── Config view buttons ────────────────────────────────────────────────
document.getElementById('btnAbrirUsuarios')?.addEventListener('click', () => {
  document.getElementById('btnGerenciarUsuarios')?.click();
});

document.getElementById('btnAbrirAuditLogs')?.addEventListener('click', () => {
  if (typeof _abrirAuditLogs === 'function') _abrirAuditLogs();
});

document.getElementById('btnAbrirPermissoes')?.addEventListener('click', () => {
  if (typeof _abrirPermissoes === 'function') _abrirPermissoes();
});

document.getElementById('btnExportXMLConfig')?.addEventListener('click', () => {
  document.getElementById('btnExportXML')?.click();
});

// ── Reports view: sync type buttons with hidden select ─────────────────
document.querySelectorAll('.report-type-btn[data-relview]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const relSelect = document.getElementById('relTipo');
    if (relSelect) relSelect.value = btn.dataset.relview;
  });
});

// ── Branding ───────────────────────────────────────────────────────────
// Fonte de verdade: localStorage > config.js BRANDING > defaults
const BRANDING_COMPANY_KEY = 'plano_branding_company';
const BRANDING_PRODUCT_KEY = 'plano_branding_product';

function _getBrandingValues() {
  const defaultProduct = (typeof BRANDING !== 'undefined' && BRANDING.product) ? BRANDING.product : 'Plano de Contas';
  const defaultCompany = (typeof BRANDING !== 'undefined' && BRANDING.company) ? BRANDING.company : '';
  const product = localStorage.getItem(BRANDING_PRODUCT_KEY) || defaultProduct;
  const company = localStorage.getItem(BRANDING_COMPANY_KEY) || defaultCompany;
  return { product, company };
}

function applyBranding() {
  try {
    const { product, company } = _getBrandingValues();

    const sidebarTitle = document.getElementById('sidebarAppTitle');
    const sidebarComp  = document.getElementById('sidebarCompanyName');
    const pillName     = document.getElementById('companyPillName');
    const loginTitle   = document.getElementById('loginTitle');
    const loginSub     = document.getElementById('loginSubtitle');
    const welcomeTitle = document.getElementById('welcomeTitle');

    if (sidebarTitle) sidebarTitle.textContent = product;
    if (sidebarComp)  sidebarComp.textContent  = company || 'Sistema Financeiro';
    if (pillName)     pillName.textContent      = company || product;
    if (loginTitle)   loginTitle.textContent    = product;
    if (loginSub)     loginSub.textContent      = company;
    if (welcomeTitle) welcomeTitle.textContent  = product;
    document.title = company ? (company + ' — ' + product) : product;

    // Preencher campos do card de identidade se estiverem visíveis
    const inpEmpresa = document.getElementById('cfgEmpresaNome');
    const inpSistema = document.getElementById('cfgSistemaNome');
    if (inpEmpresa && !inpEmpresa.dataset.dirty) inpEmpresa.value = company;
    if (inpSistema && !inpSistema.dataset.dirty) inpSistema.value = product;
  } catch(e) {}
}

function salvarIdentidade() {
  const empresa = (document.getElementById('cfgEmpresaNome')?.value || '').trim();
  const sistema = (document.getElementById('cfgSistemaNome')?.value || '').trim();
  if (empresa) localStorage.setItem(BRANDING_COMPANY_KEY, empresa);
  else         localStorage.removeItem(BRANDING_COMPANY_KEY);
  if (sistema) localStorage.setItem(BRANDING_PRODUCT_KEY, sistema);
  else         localStorage.removeItem(BRANDING_PRODUCT_KEY);
  // Limpa flag dirty
  const inpE = document.getElementById('cfgEmpresaNome');
  const inpS = document.getElementById('cfgSistemaNome');
  if (inpE) delete inpE.dataset.dirty;
  if (inpS) delete inpS.dataset.dirty;
  applyBranding();
  if (typeof showToast === 'function') showToast('Identidade salva!', 'success');
}

// ── Dark mode ──────────────────────────────────────────────────────────
function _applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function toggleDarkMode() {
  _applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
}

window.addEventListener('load', () => {
  applyBranding();

  // Botão de modo noturno
  const btnDark = document.getElementById('btnDarkToggle');
  if (btnDark) btnDark.addEventListener('click', toggleDarkMode);

  // Substituição dos inline handlers removidos do HTML (onclick/oninput)
  const btnSalvar = document.getElementById('btnSalvarIdentidade');
  if (btnSalvar) btnSalvar.addEventListener('click', salvarIdentidade);
  ['cfgEmpresaNome', 'cfgSistemaNome'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { el.dataset.dirty = '1'; });
  });
});
window.applyBranding      = applyBranding;
window.toggleDarkMode     = toggleDarkMode;
window._applyTheme        = _applyTheme;
window._getBrandingValues = _getBrandingValues;

// Expose globally
window.navigateTo = navigateTo;
