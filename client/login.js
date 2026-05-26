/**
 * login.js — UI de autenticação e gerenciamento de usuários
 * Plano de Contas — Plano de Contas
 *
 * Responsabilidades:
 *  - Exibir/ocultar overlay de login
 *  - Processar formulário de login
 *  - Atualizar badge do usuário no header
 *  - Logout
 *  - Modal de trocar senha própria
 *  - Modal de gerenciar usuários (admin)
 *  - Aplicar permissões nos botões/ações do app
 */

'use strict';

// utilitário para escapar conteúdo que será inserido em HTML (mitiga XSS)
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Referências DOM ────────────────────────────────────────────────────────
const loginOverlay   = document.getElementById('loginOverlay');
const loginForm      = document.getElementById('loginForm');
const loginUsuario   = document.getElementById('loginUsuario');
const loginSenha     = document.getElementById('loginSenha');
const loginError     = document.getElementById('loginError');
const loginErrorMsg  = document.getElementById('loginErrorMsg');
const loginBtnText   = document.getElementById('loginBtnText');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');
const inputRememberMe = document.createElement('input');

// User badge
const userBadge       = document.getElementById('userBadge');
const userBadgeAvatar = document.getElementById('userBadgeAvatar');
const userBadgeNome   = document.getElementById('userBadgeNome');
const userBadgePerfil = document.getElementById('userBadgePerfil');
const userMenu        = document.getElementById('userMenu');

// ── Inicialização ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // startup log mínimo para diagnóstico: mostra se há sessão e dados não-sensíveis
  try {
    const session = auth.currentUser();
    console.info('auth.startup', {
      isLoggedIn: auth.isLoggedIn(),
      userId: session ? session.userId : null,
      perfil: session ? session.perfil : null
    });
  } catch (e) {
    console.debug('auth.startup: erro ao ler sessão', e);
  }
  await auth.init();

  // Se houver remember-me válido, auto-login
    try {
    const raw = localStorage.getItem('plano_auth_remember_v1');
    if (raw) {
      const parsed = JSON.parse(atob(raw));
      if (parsed && parsed.userId && Date.now() < parsed.expiresAt) {
        const users = await auth.listarUsuarios();
        const user = (users || []).find(u => u.id === parsed.userId);
        if (user && user.ativo) {
            // restaura sessão sem senha
            auth.rememberLogin?.(user.id);
            // grava sessão temporária via helper público
            auth.restoreSession?.(user.id);
        }
      }
    }
  } catch {}

  if (auth.isLoggedIn()) _mostrarApp(); else _mostrarLogin();

  _bindLoginForm();
  _bindUserMenu();
  _bindTrocarSenha();
  _bindGerenciarUsuarios();
  _bindRedefinirSenha();
  _initHeaderSaldo();
});

// Header saldo: mostrar/ocultar saldo total com permissão
let _headerSaldoIniciado = false;
function _initHeaderSaldo() {
  try {
    const wrap = document.getElementById('headerSaldo');
    const btn  = document.getElementById('btnToggleSaldo');
    const valEl = document.getElementById('totalSaldoHeader');
    if (!wrap || !btn || !valEl) return;
    if (!auth || typeof auth.can !== 'function') { wrap.style.display = 'none'; return; }
    if (!auth.isLoggedIn()) { wrap.style.display = 'none'; return; }
    if (!auth.can('viewBalance')) {
      wrap.style.display = '';
      wrap.innerHTML = '<button class="btn btn-sm btn-outline" title="Sem permissão para ver o saldo" disabled>🔒</button><span style="margin-left:8px;color:#94a3b8;font-size:13px">—</span>';
      return;
    }
    wrap.style.display = '';
    if (_headerSaldoIniciado) return; // listeners já registrados
    _headerSaldoIniciado = true;

    const key = 'show_total_balance_v1';
    let show = sessionStorage.getItem(key) === '1';

    const render = async () => {
      if (!show) { valEl.textContent = '—'; return; }
      let total = 0;
      try {
        const r = window.repo;
        if (!r || typeof r.saldoAcumulado !== 'function') {
          try { window.addEventListener('repo:ready', render, { once: true }); } catch(e) {}
          return;
        }
        total = r.root ? r.saldoAcumulado(r.root) : 0;
      } catch (err) { total = 0; }
      const cor = total >= 0 ? '#16a34a' : '#dc2626';
      valEl.style.color = cor;
      valEl.textContent = (total >= 0 ? '' : '−') + formatMoeda(Math.abs(total));
    };

    btn.addEventListener('click', async () => {
      show = !show; sessionStorage.setItem(key, show ? '1' : '0');
      await render();
    });

    render();
    window.addEventListener('saldo:update', render);
  } catch (e) {}
}

// ── Mostrar / ocultar telas ────────────────────────────────────────────────
function _mostrarLogin() {
  loginOverlay.classList.add('show');
  const hdr = document.querySelector('.app-header');
  const main = document.querySelector('.app-main');
  if (hdr) hdr.style.display = 'none';
  if (main) main.style.display = 'none';
  // foco após a animação/visibilidade
  setTimeout(() => loginUsuario.focus(), 120);
  // limpar contador de bloqueio se existir
  const lockHint = document.getElementById('loginLockHint');
  if (lockHint) lockHint.style.display = 'none';
}

function _mostrarApp() {
  loginOverlay.classList.remove('show');
  const hdr = document.querySelector('.app-header');
  const main = document.querySelector('.app-main');
  if (hdr) hdr.style.display = '';
  if (main) main.style.display = '';
  _atualizarBadge();
  _aplicarPermissoes();
  if (typeof initOnboarding === 'function') initOnboarding();
  if (typeof navigateTo === 'function') navigateTo('dashboard');
}

// ── Badge do usuário ───────────────────────────────────────────────────────
function _atualizarBadge() {
  const user = auth.currentUser();
  if (!user) return;
  // Sessão incompleta (falta nome/usuario) — força logout e relogin
  if (!user.nome && !user.usuario) {
    auth.logout();
    _mostrarLogin();
    return;
  }
  const roleInfo = auth.ROLES[user.perfil] || {};
  const displayName = user.nome || user.usuario || '?';
  const primeiraLetra = displayName[0].toUpperCase();

  userBadgeAvatar.textContent = primeiraLetra;
  userBadgeAvatar.style.background = roleInfo.color || '#3b82f6';
  userBadgeNome.textContent   = displayName;
  userBadgePerfil.textContent = roleInfo.label || user.perfil || '';
  // Exibir opção de gerenciar usuários apenas para admin
  const btnGer = document.getElementById('btnGerenciarUsuarios');
  if (btnGer) btnGer.style.display = auth.can('manageUsers') ? '' : 'none';
}
// ── Aplicar permissões nos elementos da UI ─────────────────────────────────
function _aplicarPermissoes() {
  const user = auth.currentUser();
  console.log('[permissoes] perfil:', user && user.perfil, '| can addConta:', auth.can('addConta'));
  // Botões principais
  // NOVO button replaces quick-add
  _lockBtn('btnNovo',           !auth.can('addConta'),         'Sem permissão para adicionar contas');
  _lockBtn('btnRenomear',       !auth.can('renameConta'),       'Sem permissão para renomear');
  _lockBtn('btnRemover',        !auth.can('removeConta'),       'Sem permissão para remover');
  _lockBtn('btnNovoLancamento', !auth.can('newLancamento'),     'Sem permissão para lançamentos');
  _lockBtn('btnExportXML',      !auth.can('exportData'),        'Sem permissão para exportar');
  _lockBtn('btnExportCSV',      !auth.can('exportData'),        'Sem permissão para exportar');
  _lockBtn('btnRelatorio',      !auth.can('viewReports'),       'Sem permissão para relatórios');
  // Undo/Redo removed — locks omitted


  // quick-add removed; NOVO button used for creation

  // Drag & drop desabilitado para quem não pode mover
  window._authCanMove = auth.can('moveConta');
  window._authCanLanc = auth.can('newLancamento');
  window._authCanRename = auth.can('renameConta');
  window._authCanRemove = auth.can('removeConta');
  window._authCanOrcamento = auth.can('editOrcamento');
}

function _lockBtn(id, locked, title) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.dataset.locked = locked ? 'true' : 'false';
  if (locked) {
    btn.disabled = true;
    btn.title    = title;
  } else {
    // Não sobrescreve disabled se já foi desabilitado por outra regra (ex: sem seleção)
    // Apenas remove o lock de permissão
    btn.dataset.locked = 'false';
    if (btn.title === title) btn.title = '';
  }
}

// ── Formulário de Login ────────────────────────────────────────────────────
function _bindLoginForm() {
  // Toggle mostrar/ocultar senha
  const btnToggle   = document.getElementById('btnToggleSenha');
  const iconOff     = document.getElementById('iconSenhaOff');
  const iconOn      = document.getElementById('iconSenhaOn');
  btnToggle?.addEventListener('click', () => {
    const visivel = loginSenha.type === 'text';
    loginSenha.type = visivel ? 'password' : 'text';
    iconOff.style.display = visivel ? '' : 'none';
    iconOn.style.display  = visivel ? 'none' : '';
  });

  // inserir checkbox lembrar-me abaixo do botão se não existir
  if (!document.getElementById('rememberMeWrap')) {
    const wrap = document.createElement('div');
    wrap.id = 'rememberMeWrap';
    wrap.style = 'display:flex;align-items:center;gap:8px;margin-top:8px;margin-left:6px';
    wrap.innerHTML = `<label style="font-size:13px"><input type="checkbox" id="rememberMe" /> Lembrar-me</label>`;
    btnLoginSubmit.parentNode.insertBefore(wrap, btnLoginSubmit.nextSibling);
  }

  // indicador Caps Lock
  const capsHint = document.createElement('div');
  capsHint.id = 'capsHint';
  capsHint.style = 'font-size:12px;color:#f59e0b;display:none;margin-left:6px;margin-top:6px';
  capsHint.textContent = 'Caps Lock ativado';
  loginForm.appendChild(capsHint);

  // hint de bloqueio (quando receber lockUntil)
  let lockHint = document.getElementById('loginLockHint');
  if (!lockHint) {
    lockHint = document.createElement('div');
    lockHint.id = 'loginLockHint';
    lockHint.style = 'font-size:13px;color:#ef4444;margin-top:6px;display:none';
    loginForm.appendChild(lockHint);
  }

  // detectar CapsLock em senha
  loginSenha.addEventListener('keydown', (e) => {
    const caps = e.getModifierState && e.getModifierState('CapsLock');
    capsHint.style.display = caps ? '' : 'none';
  });
  loginSenha.addEventListener('keyup', (e) => {
    const caps = e.getModifierState && e.getModifierState('CapsLock');
    capsHint.style.display = caps ? '' : 'none';
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';

    const usuario = loginUsuario.value.trim();
    const senha   = loginSenha.value;
    const remember = document.getElementById('rememberMe')?.checked === true;

    if (!usuario || !senha) {
      _mostrarErroLogin('Preencha usuário e senha.');
      return;
    }

    // Feedback visual de carregamento
    btnLoginSubmit.disabled = true;
    loginBtnText.textContent = 'Entrando…';

  const resultado = await auth.login(usuario, senha);

    btnLoginSubmit.disabled = false;
    loginBtnText.textContent = 'Entrar';

    if (!resultado.ok) {
      // Mensagem genérica para não vazar informação
      _mostrarErroLogin('Usuário ou senha inválidos.');
      loginSenha.value = '';
      loginSenha.focus();
      // Animação de shake
      loginError.style.animation = 'none';
      requestAnimationFrame(() => { loginError.style.animation = ''; });
      return;
    }

    // Login OK
    loginSenha.value  = '';
    loginUsuario.value = '';
    // se remember, reaplicar
    if (remember && typeof auth.rememberLogin === 'function') {
      auth.rememberLogin(resultado.user.id, 30);
    }
    _mostrarApp();
    _initHeaderSaldo();

    // Re-inicializar a árvore com permissões atualizadas
    if (typeof renderTree === 'function') {
      renderTree();
    }
  });
}

function _mostrarErroLogin(msg) {
  loginErrorMsg.textContent    = msg;
  loginError.style.display     = 'flex';
}

// ── Menu dropdown do usuário ───────────────────────────────────────────────
let _userMenuBound = false;
function _bindUserMenu() {
  if (_userMenuBound) return;
  _userMenuBound = true;

  if (!userBadge || !userMenu) return;

  // Toggle ao clicar no badge (ignora cliques nos botões do menu)
  userBadge.addEventListener('click', function(e) {
    if (e.target.closest('#userMenu')) return; // clique veio de dentro do menu
    userMenu.style.display = (userMenu.style.display === 'none' || userMenu.style.display === '') ? 'block' : 'none';
  });

  // Fecha ao clicar fora
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#userBadge')) {
      userMenu.style.display = 'none';
    }
  });

  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', function(e) {
    e.stopPropagation();
    userMenu.style.display = 'none';
    setTimeout(function() { auth.logout(); _mostrarLogin(); }, 0);
  });

  var btnTrocarSenha = document.getElementById('btnTrocarSenha');
  if (btnTrocarSenha) btnTrocarSenha.addEventListener('click', function(e) {
    e.stopPropagation();
    userMenu.style.display = 'none';
    setTimeout(function() { _abrirTrocarSenha(); }, 0);
  });

  var btnGerenciarUsuarios = document.getElementById('btnGerenciarUsuarios');
  if (btnGerenciarUsuarios) btnGerenciarUsuarios.addEventListener('click', function(e) {
    e.stopPropagation();
    userMenu.style.display = 'none';
    setTimeout(function() { _abrirGerenciarUsuarios(); }, 0);
  });
}

// ── Modal: Trocar senha própria ────────────────────────────────────────────
function _abrirTrocarSenha() {
  const modal = document.getElementById('modalTrocarSenha');
  document.getElementById('senhaAtualInput').value     = '';
  document.getElementById('novaSenhaInput').value      = '';
  document.getElementById('confirmarSenhaInput').value = '';
  document.getElementById('trocarSenhaErro').style.display = 'none';
  modal.style.display = 'flex';
  trapFocus(modal);
  setTimeout(() => document.getElementById('senhaAtualInput').focus(), 80);
}

function _bindTrocarSenha() {
  const fechar = () => { document.getElementById('modalTrocarSenha').style.display = 'none'; };

  document.getElementById('btnFecharTrocarSenha')?.addEventListener('click', fechar);
  document.getElementById('btnCancelarTrocarSenha')?.addEventListener('click', fechar);
  document.getElementById('modalTrocarSenha')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalTrocarSenha')) fechar();
  });

  document.getElementById('btnConfirmarTrocarSenha')?.addEventListener('click', async () => {
    const senhaAtual  = document.getElementById('senhaAtualInput').value;
    const novaSenha   = document.getElementById('novaSenhaInput').value;
    const confirmar   = document.getElementById('confirmarSenhaInput').value;
    const erroEl      = document.getElementById('trocarSenhaErro');
    const erroMsgEl   = document.getElementById('trocarSenhaErroMsg');

    erroEl.style.display = 'none';

    if (!senhaAtual || !novaSenha || !confirmar) {
      erroMsgEl.textContent = 'Preencha todos os campos.';
      erroEl.style.display  = 'flex'; return;
    }
    if (novaSenha !== confirmar) {
      erroMsgEl.textContent = 'As senhas não coincidem.';
      erroEl.style.display  = 'flex'; return;
    }

    const res = await auth.trocarSenhaPropria(senhaAtual, novaSenha);
    if (!res.ok) {
      erroMsgEl.textContent = res.erro;
      erroEl.style.display  = 'flex'; return;
    }

    fechar();
    showToast('Senha alterada com sucesso!', 'success');
  });
}

// ── Modal: Gerenciar usuários ──────────────────────────────────────────────
function _abrirGerenciarUsuarios() {
  if (!auth.can('manageUsers')) return;
  const modal = document.getElementById('modalUsuarios');
  modal.style.display = 'flex';
  trapFocus(modal);
  _renderTabelaUsuarios();
  // mostrar botão de logs apenas para admin
  const btnLogs = document.getElementById('btnVerLogsUsuarios');
  if (btnLogs) {
    btnLogs.style.display = auth.can('manageUsers') ? '' : 'none';
    btnLogs.onclick = () => {
      window.location.href = 'audit.html';
    };
  }
}

function _renderTabelaUsuarios() {
  const wrap    = document.getElementById('tabelaUsuarios');
  const current = auth.currentUser();
  // Always use backend helper which handles session/refresh transparently
  const usersPromise = (async function(){
    try {
      const users = await auth.listarUsuarios();
      return users || [];
    } catch(e) { return []; }
  })();

  // resolve users promise and continue
  usersPromise.then(users => {

    if (!users || !users.length) {
      wrap.innerHTML = '<p style="color:#94a3b8;font-size:13px">Nenhum usuário cadastrado.</p>';
      return;
    }

    const showLockedCol = auth.can('manageUsers');

    let html = `<table>
      <thead><tr>
        <th>Usuário</th><th>Nome</th><th>Perfil</th><th>Status</th>` + (showLockedCol ? `<th>Bloqueado</th>` : '') + `<th>Ações</th>
      </tr></thead><tbody>`;

    for (const u of users) {
    const isSelf  = u.id === current?.userId;
    const roleInfo = auth.ROLES[u.perfil] || {};
    const statusTxt = u.ativo ? 'Ativo' : 'Inativo';
    const statusCor = u.ativo ? '#16a34a' : '#94a3b8';
    const isLocked = !!(u.lockUntil && Date.now() < u.lockUntil);
    const lockLabel = isLocked ? 'Sim' : 'Não';
  const lockTitle = isLocked ? `Bloqueado até ${new Date(u.lockUntil).toLocaleString()}` : '';

    html += `<tr class="${u.ativo ? '' : 'usuario-inativo'}" data-userid="${u.id}">
      <td><strong>${escapeHtml(u.usuario)}</strong>${isSelf ? ' <span style="font-size:10px;color:#3b82f6">(você)</span>' : ''}</td>
      <td>${escapeHtml(u.nome)}</td>
      <td>
        <select class="input-text select-perfil" data-userid="${u.id}" style="padding:3px 6px;font-size:12px;height:auto">
          ${Object.keys(auth.ROLES).map(r =>
            `<option value="${r}" ${u.perfil === r ? 'selected' : ''}>${auth.ROLES[r].label}</option>`
          ).join('')}
        </select>
      </td>
      <td><span style="color:${statusCor};font-weight:600;font-size:12px">${statusTxt}</span></td>
      ${showLockedCol ? `<td><span class="lock-badge" title="${lockTitle}" data-locked="${isLocked}">${lockLabel}</span></td>` : ''}
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-secondary btn-redef-senha" data-userid="${u.id}" data-nome="${u.nome}" title="Redefinir senha">
          🔑
        </button>
        ${auth.can('manageUsers') ? `<button class="btn btn-sm btn-outline btn-unlock" data-userid="${u.id}" title="Desbloquear usuário">🔓</button>` : ''}
        <button class="btn btn-sm ${u.ativo ? 'btn-warning' : 'btn-success'} btn-toggle-ativo"
                data-userid="${u.id}" title="${u.ativo ? 'Desativar' : 'Ativar'}" ${isSelf ? 'disabled' : ''}>
          ${u.ativo ? '🚫' : '✅'}
        </button>
        <button class="btn btn-sm btn-danger btn-remover-usu" data-userid="${u.id}" title="Remover usuário" ${isSelf ? 'disabled' : ''}>
          🗑
        </button>
      </td>
    </tr>`;
  }

  html += '</tbody></table>';
  wrap.innerHTML = html;

  // Evento: alterar perfil via select
  wrap.querySelectorAll('.select-perfil').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const userId = +e.target.dataset.userid;
      const res    = await auth.alterarPerfil(userId, e.target.value);
      if (!res.ok) { showToast(res.erro, 'error'); _renderTabelaUsuarios(); return; }
      showToast('Perfil atualizado.', 'success');
      _renderTabelaUsuarios();
    });
  });

    // Evento: toggle ativo
    wrap.querySelectorAll('.btn-toggle-ativo').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = +btn.dataset.userid;
        const res    = await auth.toggleAtivo(userId);
        if (!res.ok) { showToast(res.erro || 'Erro', 'error'); return; }
        _renderTabelaUsuarios();
      });
    });

    // Evento: desbloquear usuário (admin)
    wrap.querySelectorAll('.btn-unlock').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = +btn.dataset.userid;
        const res = await auth.unlockUser(userId);
        if (!res.ok) { showToast(res.erro || 'Erro', 'error'); return; }
        showToast('Usuário desbloqueado.', 'success');
        _renderTabelaUsuarios();
      });
    });

  // Evento: redefinir senha
    wrap.querySelectorAll('.btn-redef-senha').forEach(btn => {
      btn.addEventListener('click', () => {
        _abrirRedefinirSenha(+btn.dataset.userid, btn.dataset.nome);
      });
    });

  // Evento: remover usuário
    wrap.querySelectorAll('.btn-remover-usu').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = +btn.dataset.userid;
        confirmar(
          'Remover Usuário',
          `Remover o usuário? Esta ação não pode ser desfeita.`,
          async () => {
            const res = await auth.removerUsuario(userId);
            if (!res.ok) { showToast(res.erro || 'Erro', 'error'); return; }
            showToast('Usuário removido.', 'success'); _renderTabelaUsuarios();
          },
          { confirmClass: 'btn-danger' }
        );
      });
    });
  });
}

function _bindGerenciarUsuarios() {
  const fechar = () => { document.getElementById('modalUsuarios').style.display = 'none'; };

  document.getElementById('btnFecharUsuarios')?.addEventListener('click', fechar);
  document.getElementById('modalUsuarios')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalUsuarios')) fechar();
  });

  document.getElementById('btnCriarUsuario')?.addEventListener('click', async () => {
    const usuario = document.getElementById('novoUsuLogin').value.trim();
    const nome    = document.getElementById('novoUsuNome').value.trim();
    const senha   = document.getElementById('novoUsuSenha').value;
    const perfil  = document.getElementById('novoUsuPerfil').value;

    if (!usuario || !nome || !senha) {
      showToast('Preencha todos os campos obrigatórios.', 'warning'); return;
    }
    // força de senha básica
    const strength = _passwordStrength(senha);
    if (strength.score < 2) { showToast('Senha fraca. Use ao menos 6 caracteres, misture letras e números.', 'warning'); return; }

    const base = (typeof API_BASE !== 'undefined') ? API_BASE : ((location && location.protocol === 'file:') ? 'http://localhost:3000' : '');
    const resp = await fetch(base + '/api/users', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ usuario, nome, senha, perfil }) });
    const data = await resp.json(); if (!data.ok) { showToast(data.erro||'Erro', 'error'); return; }
    showToast(`Usuário "${usuario}" criado com sucesso!`, 'success');
    document.getElementById('novoUsuLogin').value  = '';
    document.getElementById('novoUsuNome').value   = '';
    document.getElementById('novoUsuSenha').value  = '';
    _renderTabelaUsuarios();
    return;

    showToast(`Usuário "${usuario}" criado com sucesso!`, 'success');
    document.getElementById('novoUsuLogin').value  = '';
    document.getElementById('novoUsuNome').value   = '';
    document.getElementById('novoUsuSenha').value  = '';
    _renderTabelaUsuarios();
  });
}

// Atualiza visual do strength bar
function _updateStrengthBar(elId, pw) {
  const wrap = document.getElementById(elId);
  if (!wrap) return;
  const bar = wrap.querySelector('i');
  const s = _passwordStrength(pw).score;
  const pct = (s / 4) * 100;
  bar.style.width = pct + '%';
  wrap.classList.remove('weak','medium','good');
  if (s <= 1) wrap.classList.add('weak');
  else if (s === 2 || s === 3) wrap.classList.add('medium');
  else wrap.classList.add('good');
}

// Bind para strength nos forms
document.addEventListener('DOMContentLoaded', () => {
  const novoPw = document.getElementById('novoUsuSenha');
  if (novoPw) novoPw.addEventListener('input', e => _updateStrengthBar('novoUsuPwStrength', e.target.value));

  const trocarPw = document.getElementById('novaSenhaInput');
  if (trocarPw) trocarPw.addEventListener('input', e => _updateStrengthBar('trocarPwStrength', e.target.value));

  const redefPw = document.getElementById('redefinirSenhaInput');
  if (redefPw) redefPw.addEventListener('input', e => _updateStrengthBar('redefinirPwStrength', e.target.value));

  // Interceptar confirmar troca de senha para validar força
  // Para trocar senha, o handler do botão está registrado em _bindTrocarSenha.
  // Aqui apenas validamos força e deixamos o handler original executar se tudo ok.
  const _btnTrocar = document.getElementById('btnConfirmarTrocarSenha');
  _btnTrocar?.addEventListener('click', (ev) => {
    const nova = document.getElementById('novaSenhaInput').value;
    const conf = document.getElementById('confirmarSenhaInput').value;
    if (!nova || !conf) { showToast('Preencha todos os campos.', 'warning'); ev.preventDefault(); return; }
    if (nova !== conf) { showToast('As senhas não coincidem.', 'warning'); ev.preventDefault(); return; }
    const s = _passwordStrength(nova).score;
    if (s < 2) { showToast('Senha muito fraca. Use ao menos 6 caracteres e combine letras e números.', 'warning'); ev.preventDefault(); return; }
    // se ok, permite que o handler registrado anteriormente execute normalmente
  });

  // Interceptar redefinir senha do admin
  document.getElementById('btnConfirmarRedefinirSenha')?.addEventListener('click', async (e) => {
    const nova = document.getElementById('redefinirSenhaInput').value;
    const conf = document.getElementById('redefinirSenhaConfirmar').value;
    if (!nova || !conf) { showToast('Preencha os campos de senha.', 'warning'); return; }
    if (nova !== conf) { showToast('As senhas não coincidem.', 'warning'); return; }
    const s = _passwordStrength(nova).score;
    if (s < 2) { showToast('Senha muito fraca. Use ao menos 6 caracteres e combine letras e números.', 'warning'); return; }
    // o handler registrado anteriormente fará a redefinição via auth.redefinirSenha
    // dispatch original event to let it proceed
  });
});

// ── Modal: Redefinir senha de outro usuário ────────────────────────────────
function _abrirRedefinirSenha(userId, nome) {
  const modal = document.getElementById('modalRedefinirSenha');
  document.getElementById('redefinirSenhaNomeUsuario').textContent = `Usuário: ${nome}`;
  document.getElementById('redefinirSenhaInput').value    = '';
  document.getElementById('redefinirSenhaConfirmar').value = '';
  document.getElementById('redefinirSenhaErro').style.display = 'none';
  document.getElementById('btnConfirmarRedefinirSenha').dataset.userid = userId;
  modal.style.display = 'flex';
  trapFocus(modal);
  setTimeout(() => document.getElementById('redefinirSenhaInput').focus(), 80);
}

function _bindRedefinirSenha() {
  const fechar = () => { document.getElementById('modalRedefinirSenha').style.display = 'none'; };

  document.getElementById('btnFecharRedefinirSenha')?.addEventListener('click', fechar);
  document.getElementById('btnCancelarRedefinirSenha')?.addEventListener('click', fechar);
  document.getElementById('modalRedefinirSenha')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalRedefinirSenha')) fechar();
  });

  document.getElementById('btnConfirmarRedefinirSenha')?.addEventListener('click', async (e) => {
    const userId  = +e.currentTarget.dataset.userid;
    const nova    = document.getElementById('redefinirSenhaInput').value;
    const conf    = document.getElementById('redefinirSenhaConfirmar').value;
    const erroEl  = document.getElementById('redefinirSenhaErro');
    const erroMsg = document.getElementById('redefinirSenhaErroMsg');

    erroEl.style.display = 'none';

    if (!nova || !conf) {
      erroMsg.textContent = 'Preencha os campos de senha.';
      erroEl.style.display = 'flex'; return;
    }
    if (nova !== conf) {
      erroMsg.textContent = 'As senhas não coincidem.';
      erroEl.style.display = 'flex'; return;
    }

    const base = (typeof API_BASE !== 'undefined') ? API_BASE : ((location && location.protocol === 'file:') ? 'http://localhost:3000' : '');
    const resp = await fetch(base + '/api/users/' + userId + '/reset-password', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ nova }) });
    const data = await resp.json(); if (!data.ok) { erroMsg.textContent = data.erro || 'Erro'; erroEl.style.display = 'flex'; return; }
    fechar(); showToast('Senha redefinida com sucesso!', 'success'); return;
  });
}

// ── Utilitários: força de senha (simples) e checagem periódica de sessão
function _passwordStrength(pw) {
  let score = 0;
  if (!pw || pw.length < 1) return { score: 0 };
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return { score: Math.min(score, 4) };
}

// ── Modal: Permissões por Usuário ────────────────────────────────────────
const _PERM_GRUPOS = [
  {
    label: 'Plano de Contas',
    cor: '#2563eb',
    itens: [
      { key: 'addConta',    label: 'Criar conta' },
      { key: 'renameConta', label: 'Renomear / editar conta' },
      { key: 'removeConta', label: 'Excluir conta' },
      { key: 'moveConta',   label: 'Mover conta na hierarquia' },
    ]
  },
  {
    label: 'Lançamentos',
    cor: '#16a34a',
    itens: [
      { key: 'newLancamento',    label: 'Criar lançamento' },
      { key: 'editLancamento',   label: 'Editar lançamento' },
      { key: 'removeLancamento', label: 'Excluir lançamento' },
      { key: 'editOrcamento',    label: 'Editar orçamento das contas' },
    ]
  },
  {
    label: 'Relatórios e Dados',
    cor: '#d97706',
    itens: [
      { key: 'viewReports', label: 'Visualizar relatórios' },
      { key: 'viewBalance', label: 'Visualizar saldo total' },
      { key: 'exportData',  label: 'Exportar dados (XML / CSV)' },
    ]
  },
  {
    label: 'Administração',
    cor: '#dc2626',
    itens: [
      { key: 'manageUsers', label: 'Gerenciar usuários e permissões' },
    ]
  },
];

let _permUsuariosCache = [];

async function _abrirPermissoes() {
  if (!auth.can('manageUsers')) {
    if (typeof showToast === 'function') showToast('Sem permissão para gerenciar permissões.', 'warning');
    return;
  }

  const modal = document.getElementById('modalPermissoes');
  if (!modal) return;

  const fechar = () => { modal.style.display = 'none'; };
  document.getElementById('btnFecharPermissoes').onclick  = fechar;
  document.getElementById('btnCancelarPermissoes').onclick = fechar;
  modal.onclick = null;
  setTimeout(() => { modal.onclick = (e) => { if (e.target === modal) fechar(); }; }, 50);

  // Carregar usuários e sincronizar permissões do servidor
  const users = await auth.listarUsuarios();
  _permUsuariosCache = users || [];
  // Atualiza cache local com permissões vindas do servidor
  if (_permUsuariosCache.length) {
    await auth.carregarPermissoesServidor(_permUsuariosCache.map(u => u.id));
  }

  const sel = document.getElementById('permUsuarioSelect');
  sel.innerHTML = '<option value="">— Selecione um usuário —</option>';
  _permUsuariosCache.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = (u.nome || u.usuario) + ' (' + u.usuario + ')';
    sel.appendChild(opt);
  });

  // Reset
  document.getElementById('permCorpo').innerHTML =
    '<div style="text-align:center;padding:40px;color:var(--c-text-muted);font-size:13px">Selecione um usuário para configurar suas permissões.</div>';
  document.getElementById('btnSalvarPermissoes').disabled = true;
  document.getElementById('permSalvoInfo').textContent = '';
  const badge = document.getElementById('permUsuarioBadge');
  badge.style.display = 'none';

  sel.onchange = () => {
    const uid = +sel.value;
    if (!uid) {
      document.getElementById('permCorpo').innerHTML =
        '<div style="text-align:center;padding:40px;color:var(--c-text-muted);font-size:13px">Selecione um usuário.</div>';
      document.getElementById('btnSalvarPermissoes').disabled = true;
      badge.style.display = 'none';
      return;
    }
    const user = _permUsuariosCache.find(u => u.id === uid);
    if (!user) return;

    // Badge do perfil
    const roleInfo = auth.ROLES[user.perfil] || { label: user.perfil, color: '#64748b' };
    badge.textContent = roleInfo.label;
    badge.style.background = roleInfo.color + '20';
    badge.style.color = roleInfo.color;
    badge.style.border = '1px solid ' + roleInfo.color + '40';
    badge.style.display = '';

    _renderPermissoesEditor(user);
    document.getElementById('btnSalvarPermissoes').disabled = false;
    document.getElementById('permSalvoInfo').textContent = '';
  };

  // Salvar
  document.getElementById('btnSalvarPermissoes').onclick = () => _salvarPermissoes();

  modal.style.display = 'flex';
  setTimeout(() => sel.focus(), 80);
}

function _renderPermissoesEditor(user) {
  const corpo = document.getElementById('permCorpo');
  const permsEfetivas = auth.getPermissoesEfetivas(user.id, user.perfil);
  const permsDefault  = auth.getPerfilPadrao(user.perfil);

  let html = '';
  for (const grupo of _PERM_GRUPOS) {
    html += `
      <div style="margin-bottom:18px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
                    color:${grupo.cor};margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span style="flex:1;height:1px;background:${grupo.cor}20"></span>
          ${escapeHtml(grupo.label)}
          <span style="flex:1;height:1px;background:${grupo.cor}20"></span>
        </div>
        <div style="display:grid;gap:4px">`;

    for (const item of grupo.itens) {
      const efetivo  = permsEfetivas[item.key] === true;
      const padrao   = permsDefault[item.key]  === true;
      const override = permsEfetivas[item.key] !== padrao;

      html += `
        <label class="perm-row" style="display:flex;align-items:center;gap:10px;padding:7px 10px;
               border-radius:6px;cursor:pointer;user-select:none;
               background:${efetivo ? 'var(--c-primary-lt)' : 'transparent'};
               border:1px solid ${efetivo ? 'var(--c-primary)30' : 'var(--c-border)'}">
          <input type="checkbox" data-perm="${item.key}" ${efetivo ? 'checked' : ''}
                 style="accent-color:var(--c-primary);width:15px;height:15px;cursor:pointer">
          <span style="flex:1;font-size:13px;font-weight:${efetivo ? '500' : '400'};
                       color:${efetivo ? 'var(--c-text)' : 'var(--c-text-muted)'}">
            ${escapeHtml(item.label)}
          </span>
          ${override ? `<span style="font-size:10.5px;padding:2px 7px;border-radius:10px;white-space:nowrap;
                       background:#fef9c3;color:#92400e;border:1px solid #fde68a">✎ modificado</span>` : ''}
        </label>`;
    }

    html += `</div></div>`;
  }

  corpo.innerHTML = html;

  // Atualizar visual ao mudar checkbox
  corpo.querySelectorAll('input[data-perm]').forEach(cb => {
    cb.addEventListener('change', () => {
      const label = cb.closest('label');
      const checked = cb.checked;
      label.style.background = checked ? 'var(--c-primary-lt)' : 'transparent';
      label.style.border = `1px solid ${checked ? 'var(--c-primary)30' : 'var(--c-border)'}`;
      label.querySelector('span[style*="font-size:13px"]').style.fontWeight = checked ? '500' : '400';
      label.querySelector('span[style*="font-size:13px"]').style.color = checked ? 'var(--c-text)' : 'var(--c-text-muted)';
      document.getElementById('permSalvoInfo').textContent = '';
    });
  });
}

async function _salvarPermissoes() {
  const sel  = document.getElementById('permUsuarioSelect');
  const uid  = +sel.value;
  if (!uid) return;

  const perms = {};
  document.querySelectorAll('#permCorpo input[data-perm]').forEach(cb => {
    perms[cb.dataset.perm] = cb.checked;
  });

  const btn = document.getElementById('btnSalvarPermissoes');
  btn.disabled = true;
  const ok = await auth.salvarPermissoesUsuario(uid, perms);
  btn.disabled = false;
  if (ok) {
    if (typeof showToast === 'function') showToast('Permissões salvas com sucesso!', 'success');
    const user = _permUsuariosCache.find(u => u.id === uid);
    document.getElementById('permSalvoInfo').textContent = '✓ Salvo';
    if (user) _renderPermissoesEditor(user);
  } else {
    if (typeof showToast === 'function') showToast('Erro ao salvar permissões.', 'error');
  }
}

// ── Modal: Logs de Auditoria ──────────────────────────────────────────────

// Estado interno do modal
const _auditState = { page: 1, limit: 50, total: 0, pages: 0, lastFilters: {} };

// Mapa de labels amigáveis para cada ação
const _auditActionLabels = {
  login:                  { label: 'Login',               cat: 'auth',    color: '#16a34a' },
  failed_login:           { label: 'Login falhou',         cat: 'auth',    color: '#dc2626' },
  token_renovado:         { label: 'Token renovado',       cat: 'auth',    color: '#64748b' },
  create_user:            { label: 'Usuário criado',       cat: 'usuario', color: '#2563eb' },
  update_user:            { label: 'Usuário editado',      cat: 'usuario', color: '#f59e0b' },
  remove_user:            { label: 'Usuário removido',     cat: 'usuario', color: '#dc2626' },
  reset_password:         { label: 'Senha redefinida',     cat: 'usuario', color: '#f59e0b' },
  change_password:        { label: 'Senha alterada',       cat: 'usuario', color: '#f59e0b' },
  unlock_user:            { label: 'Usuário desbloqueado', cat: 'usuario', color: '#16a34a' },
  conta_criada:           { label: 'Conta criada',         cat: 'conta',   color: '#2563eb' },
  conta_editada:          { label: 'Conta editada',        cat: 'conta',   color: '#f59e0b' },
  conta_deletada:         { label: 'Conta deletada',       cat: 'conta',   color: '#dc2626' },
  lancamento_criado:      { label: 'Lançamento criado',    cat: 'lancamento', color: '#2563eb' },
  lancamento_editado:     { label: 'Lançamento editado',   cat: 'lancamento', color: '#f59e0b' },
  lancamento_deletado:    { label: 'Lançamento deletado',  cat: 'lancamento', color: '#dc2626' },
};

function _abrirAuditLogs() {
  if (!auth.can('manageUsers')) return;
  const modal = document.getElementById('modalAuditLogs');
  if (!modal) return;
  modal.style.display = 'flex';

  // Bind fechar (usando onclick evita acumulação de listeners a cada abertura)
  const fechar = () => { modal.style.display = 'none'; };
  document.getElementById('btnFecharAuditLogs').onclick = fechar;
  // Usar setTimeout para só registrar o handler de fechar APÓS o clique atual terminar
  modal.onclick = null;
  setTimeout(() => {
    modal.onclick = (e) => { if (e.target === modal) fechar(); };
  }, 50);

  // Bind buscar / limpar
  document.getElementById('btnAuditBuscar').onclick = () => { _auditState.page = 1; _carregarAuditLogs(); };
  document.getElementById('btnAuditLimpar').onclick = () => {
    document.getElementById('auditFiltroDataI').value = '';
    document.getElementById('auditFiltroDataF').value = '';
    document.getElementById('auditFiltroEntityType').value = '';
    document.getElementById('auditFiltroAction').value = '';
    document.getElementById('auditFiltroEntityId').value = '';
    _auditState.page = 1;
    document.getElementById('auditLogsTabela').innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:12px">Use os filtros acima e clique em Buscar.</p>';
    document.getElementById('auditLogsInfo').textContent = '';
    document.getElementById('auditPaginacao').style.display = 'none';
  };

  // Bind paginação
  document.getElementById('btnAuditPrev').onclick = () => {
    if (_auditState.page > 1) { _auditState.page--; _carregarAuditLogs(); }
  };
  document.getElementById('btnAuditNext').onclick = () => {
    if (_auditState.page < _auditState.pages) { _auditState.page++; _carregarAuditLogs(); }
  };

  // Bind exportar CSV
  document.getElementById('btnExportarAuditCSV').onclick = () => _exportarAuditCSV();

  // Focar no primeiro campo e carregar
  setTimeout(() => document.getElementById('auditFiltroDataI')?.focus(), 80);
  _auditState.page = 1;
  _carregarAuditLogs();
}

function _coletarFiltrosAudit() {
  return {
    dtI:        document.getElementById('auditFiltroDataI').value || undefined,
    dtF:        document.getElementById('auditFiltroDataF').value || undefined,
    entityType: document.getElementById('auditFiltroEntityType').value || undefined,
    action:     document.getElementById('auditFiltroAction').value || undefined,
    entityId:   document.getElementById('auditFiltroEntityId').value.trim() || undefined,
    page:       _auditState.page,
    limit:      _auditState.limit,
  };
}

async function _carregarAuditLogs() {
  const tabela  = document.getElementById('auditLogsTabela');
  const info    = document.getElementById('auditLogsInfo');
  const pag     = document.getElementById('auditPaginacao');
  tabela.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:12px">Carregando...</p>';
  info.textContent = '';
  pag.style.display = 'none';

  const filters = _coletarFiltrosAudit();
  _auditState.lastFilters = filters;
  const res = await auth.listAudit(filters);
  if (!res.ok) { tabela.innerHTML = `<p style="color:#dc2626;padding:12px">${escapeHtml(res.erro || 'Erro ao carregar logs')}</p>`; return; }

  const { entries = [], total = 0, page = 1, pages = 1 } = res;
  _auditState.total = total;
  _auditState.page  = page;
  _auditState.pages = pages;

  info.textContent = `${total} registro${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''} — página ${page} de ${pages}`;

  if (!entries.length) {
    tabela.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:12px">Nenhum registro encontrado para os filtros aplicados.</p>';
    return;
  }

  let html = `<table class="audit-table">
    <thead><tr>
      <th>Data / Hora</th>
      <th>Ação</th>
      <th>Entidade</th>
      <th>ID/Código</th>
      <th>Ator (ID)</th>
      <th>IP</th>
      <th>Detalhes</th>
    </tr></thead><tbody>`;

  for (const e of entries) {
    const info_action = _auditActionLabels[e.action] || { label: e.action, color: '#64748b' };
    const when = e.when ? new Date(e.when).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—';
    const entityTypeFmt = { conta: 'Conta', lancamento: 'Lançamento', usuario: 'Usuário' }[e.entityType] || (e.entityType || '—');
    const detailStr = e.detail ? JSON.stringify(e.detail, null, 1).replace(/\n/g, ' ') : '—';
    const detailShort = detailStr.length > 80 ? detailStr.slice(0, 80) + '…' : detailStr;
    // Compatibilidade com formato antigo (targetUserId) e novo (actorUserId)
    const atorId = e.actorUserId != null ? e.actorUserId : (e.targetUserId != null ? e.targetUserId : null);

    html += `<tr>
      <td class="audit-td-when">${escapeHtml(when)}</td>
      <td><span class="audit-badge" style="background:${info_action.color}20;color:${info_action.color};border-color:${info_action.color}40">${escapeHtml(info_action.label)}</span></td>
      <td>${escapeHtml(entityTypeFmt)}</td>
      <td class="audit-td-id">${escapeHtml(e.entityId || '—')}</td>
      <td>${escapeHtml(atorId != null ? String(atorId) : '—')}</td>
      <td class="audit-td-ip">${escapeHtml(e.ip || '—')}</td>
      <td class="audit-td-detail" title="${escapeHtml(detailStr)}">${escapeHtml(detailShort)}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  tabela.innerHTML = html;

  // Paginação
  if (pages > 1) {
    pag.style.display = 'flex';
    document.getElementById('auditPaginaInfo').textContent = `Página ${page} de ${pages}`;
    document.getElementById('btnAuditPrev').disabled = (page <= 1);
    document.getElementById('btnAuditNext').disabled = (page >= pages);
  }
}

async function _exportarAuditCSV() {
  // Buscar todos os registros (sem paginação) com os filtros atuais
  const allFilters = { ..._auditState.lastFilters, page: 1, limit: 5000 };
  const res = await auth.listAudit(allFilters);
  if (!res.ok || !res.entries.length) { showToast('Nenhum dado para exportar', 'warning'); return; }

  const cols = ['when', 'action', 'entityType', 'entityId', 'actorUserId', 'ip', 'userAgent', 'detail'];
  const header = cols.join(';');
  const rows = res.entries.map(e => cols.map(c => {
    let v = e[c];
    if (c === 'detail') v = v ? JSON.stringify(v) : '';
    if (c === 'when' && v) v = new Date(v).toLocaleString('pt-BR');
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }).join(';'));

  const csv = '\uFEFF' + header + '\n' + rows.join('\n'); // BOM para Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'audit_logs_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${res.entries.length} registros exportados.`, 'success');
}

// Verificação periódica de sessão ativa (1 minuto)
setInterval(() => {
  try {
    if (!auth.isLoggedIn()) return;
    const s = auth.currentUser();
    if (!s) { auth.logout(); _mostrarLogin(); showToast('Sessão expirada. Faça login novamente.', 'info'); }
  } catch (e) {}
}, 60 * 1000);
