/**
 * auth.js — Módulo de Autenticação e Autorização
 *
 * Autenticação via API (cookie httpOnly). Sessão em sessionStorage (userId,
 * perfil, permissões efetivas). Sem JWT no cliente.
 * Perfis: admin | gerente | operador | visualizador
 */

'use strict';

// ── Constantes ─────────────────────────────────────────────────────────────
const AUTH_USERS_KEY   = 'plano_auth_users_v1';
const AUTH_SESSION_KEY = 'plano_auth_session_v1';
const SESSION_TTL_MS   = 8 * 60 * 60 * 1000; // 8 horas
const REMEMBER_ME_KEY  = 'plano_auth_remember_v1';
const LOCKOUT_THRESHOLD = 5; // tentativas
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const PBKDF2_ITERATIONS = 120000; // custo razoável para cliente
const SALT_BYTES = 16;
const AUTH_AUDIT_KEY   = 'plano_auth_audit_v1';
const AUTH_PERMS_KEY   = 'plano_user_perms_v2'; // overrides por usuário

// ── Perfis e permissões ────────────────────────────────────────────────────
const ROLES = {
  admin:        { label: 'Administrador', color: '#dc2626', badge: 'A' },
  gerente:      { label: 'Gerente',       color: '#d97706', badge: 'G' },
  operador:     { label: 'Operador',      color: '#2563eb', badge: 'O' },
  visualizador: { label: 'Visualizador',  color: '#64748b', badge: 'V' },
};

/**
 * Matriz de permissões por perfil.
 * Cada chave é uma ação que pode ser verificada com auth.can('acao').
 */
const PERMISSIONS = {
  //                       admin  gerente  operador  visualizador
  addConta:         { admin: true,  gerente: true,  operador: false, visualizador: false },
  renameConta:      { admin: true,  gerente: true,  operador: false, visualizador: false },
  removeConta:      { admin: true,  gerente: false, operador: false, visualizador: false },
  moveConta:        { admin: true,  gerente: true,  operador: false, visualizador: false },
  newLancamento:    { admin: true,  gerente: true,  operador: true,  visualizador: false },
  editLancamento:   { admin: true,  gerente: true,  operador: true,  visualizador: false },
  removeLancamento: { admin: true,  gerente: true,  operador: false, visualizador: false },
  editOrcamento:    { admin: true,  gerente: true,  operador: false, visualizador: false },
  exportData:       { admin: true,  gerente: true,  operador: true,  visualizador: true  },
  viewReports:      { admin: true,  gerente: true,  operador: true,  visualizador: true  },
  viewBalance:      { admin: true,  gerente: true,  operador: true,  visualizador: false },
  manageUsers:      { admin: true,  gerente: false, operador: false, visualizador: false },
  // undoRedo permission removed — feature deprecated in UI
};

// ── Hash SHA-256 (assíncrono, Web Crypto API) ──────────────────────────────
// Gerar salt aleatório (Uint8Array -> hex)
function _randomSaltHex() {
  const buf = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

// PBKDF2 com SHA-256 -> hex
async function pbkdf2Hex(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const passKey = enc.encode(password);
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', passKey, { name: 'PBKDF2' }, false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 legacy (mantido para migração)
async function sha256(text) {
  const encoder = new TextEncoder();
  const data    = encoder.encode(text);
  const hash    = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Gerenciador de Autenticação ────────────────────────────────────────────
const auth = (function () {

  // API base: quando a página é aberta via file:// usamos http://localhost:3000
  const API_BASE = (location && location.protocol === 'file:') ? 'http://localhost:3000' : '';
  // Tornar API_BASE disponível globalmente para outros scripts
  try { window.API_BASE = API_BASE; } catch (e) {}

  /**
   * Helper para efetuar fetchs ao backend usando API_BASE e injetando Authorization
   * Se houver token na sessionStorage ou localStorage, ele será usado automaticamente.
   * Retorna o Response do fetch (não faz json() automaticamente).
   */
  async function _apiFetch(path, opts = {}) {
    const base = (typeof API_BASE !== 'undefined') ? API_BASE : ((location && location.protocol === 'file:') ? 'http://localhost:3000' : '');
    const url = (path.startsWith('http://') || path.startsWith('https://')) ? path : (base + path);
    const headers = Object.assign({}, opts.headers || {});
    // O cookie httpOnly auth_token é enviado automaticamente pelo browser com credentials:'include'
    // Tokens não são armazenados em sessionStorage/localStorage (vulnerável a XSS)
    const finalOpts = Object.assign({}, opts, { headers, credentials: 'include' });
    let resp = await fetch(url, finalOpts);
    // If unauthorized, try refresh once
    if (resp.status === 401) {
      try {
        const r = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/refresh', { method: 'POST', credentials: 'include' });
        if (r.ok) {
          const d = await r.json(); if (d && d.ok) {
            // retry original request — refreshed auth_token cookie is sent automatically
            const retryOpts = Object.assign({}, opts, { headers, credentials: 'include' });
            resp = await fetch(url, retryOpts);
          }
        }
      } catch (e) {}
    }
    return resp;
  }

  // ── Carregar/salvar usuários ─────────────────────────────────────────────
  function _loadUsers() {
    // Local user storage disabled in backend-only mode.
    return null;
  }

  function _saveUsers(users) {
    // No-op in backend-only mode to avoid storing sensitive data in browser
    try { console.debug('auth: _saveUsers called in backend-only mode; operation ignored'); } catch(e){}
  }

  // ── Inicializar usuários padrão ──────────────────────────────────────────
  async function _initDefaultUsers() {
    // No-op: local user storage removed in backend-only mode
    return;
  }

  /**
   * Bootstraps or resets the default admin user.
   * Útil para desenvolvimento/recuperação local quando a conta admin foi perdida.
   * Não chama checks de autorização (destinado a ambientes locais).
   * Uso: no console do navegador execute `auth.bootstrapAdmin()` para garantir admin/admin123.
   */
  async function bootstrapAdmin(password = 'admin') {
    // Disabled in backend-only mode. Use server-side administration instead.
    return { ok:false, erro: 'bootstrapAdmin desabilitado. Use o servidor para gerenciar usuários.' };
  }

  // ── Auditoria simples (events stored in localStorage) ──────────────────
  function _pushAudit(action, targetUserId, actorUserId = null) {
    // Prefer sending audit to server when possible
    (async () => {
      try {
        await _apiFetch('/api/audit', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ action, targetUserId, actorUserId }) });
        return;
      } catch(e) {}
      try {
        const raw = localStorage.getItem(AUTH_AUDIT_KEY);
        const arr = raw ? JSON.parse(atob(raw)) : [];
        arr.push({ action, targetUserId, actorUserId, when: new Date().toISOString() });
        localStorage.setItem(AUTH_AUDIT_KEY, btoa(JSON.stringify(arr)));
      } catch (e) { /* swallow */ }
    })();
  }

  async function listAudit(filters = {}) {
    if (!can('manageUsers')) return { ok: false, erro: 'Sem permissão.' };
    // Monta query string com os filtros passados
    const qs = Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    try {
      const resp = await _apiFetch('/api/audit' + (qs ? '?' + qs : ''), { method: 'GET' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return { ok: true, entries: data.entries, total: data.total, page: data.page, limit: data.limit, pages: data.pages };
        return { ok: false, erro: data?.erro || 'Erro ao ler logs.' };
      }
      // Retornar o erro HTTP ao invés de cair no fallback silenciosamente
      return { ok: false, erro: `Erro ${resp.status} ao carregar logs de auditoria.` };
    } catch (e) {
      return { ok: false, erro: 'Serviço indisponível.' };
    }
  }

  // ── Sessão ───────────────────────────────────────────────────────────────
  function _getSession() {
    try {
      const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (Date.now() > session.expiresAt) {
        sessionStorage.removeItem(AUTH_SESSION_KEY);
        return null;
      }
      return session;
    } catch { return null; }
  }

  function _saveSession(user, remember = false, permissions = {}) {
    const session = {
      userId:      user.id,
      usuario:     user.usuario,
      nome:        user.nome,
      perfil:      user.perfil,
      permissions, // overrides carregados do servidor — nunca do localStorage
      loginAt:     new Date().toISOString(),
      expiresAt:   Date.now() + SESSION_TTL_MS,
    };
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    if (remember) {
      localStorage.setItem(REMEMBER_ME_KEY, btoa(JSON.stringify({ userId: user.id, expiresAt: Date.now() + (30*24*60*60*1000) })));
    }
    return session;
  }

  function rememberLogin(userId, days = 30) {
    localStorage.setItem(REMEMBER_ME_KEY, btoa(JSON.stringify({ userId, expiresAt: Date.now() + days * 24 * 60 * 60 * 1000 })));
  }

  function clearRemember() {
    localStorage.removeItem(REMEMBER_ME_KEY);
  }

  /** Restaura sessão a partir de um userId (se existir) */
  function restoreSession(userId) {
    const users = _loadUsers() || [];
    const user = users.find(u => u.id === userId);
    if (!user || !user.ativo) return false;
    _saveSession(user);
    return true;
  }

  function _clearSession() {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
  }

  // ── API pública ──────────────────────────────────────────────────────────

  /** Inicializa o módulo (chama antes do app carregar) */
  async function init() {
    // Backend-only mode: do not create local admin. Ensure any client-side
    // initialization that depended on local users is skipped.
    return;
  }

  /** Retorna o usuário logado ou null */
  function currentUser() {
    return _getSession();
  }

  /** Verifica se há sessão ativa */
  function isLoggedIn() {
    return _getSession() !== null;
  }

  /** Tenta autenticar; retorna { ok, erro } */
  async function login(usuario, senha) {
    // Strict backend-only login. Do not attempt local fallback.
    const GENERIC_ERR = 'Usuário ou senha inválidos.';
    try {
      const resp = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, senha }),
        credentials: 'include'
      });
      if (!resp.ok) return { ok: false, erro: GENERIC_ERR };
      const data = await resp.json();
      if (data && data.ok && data.user) {
        // Buscar permissões efetivas do servidor (overrides por usuário, se existirem)
        let permissions = {};
        try {
          const pr = await _apiFetch('/api/users/' + data.user.id + '/permissions');
          if (pr.ok) { const pd = await pr.json(); if (pd && pd.ok) permissions = pd.permissions || {}; }
        } catch {}
        _saveSession(data.user, false, permissions);
        return { ok: true, user: data.user };
      }
      return { ok: false, erro: GENERIC_ERR };
    } catch (e) {
      return { ok: false, erro: 'Serviço indisponível.' };
    }
  }

  /** Desbloquear usuário (apenas admin) */
  async function unlockUser(userId) {
    if (!can('manageUsers')) return { ok: false, erro: 'Sem permissão.' };
    // tenta backend
    try {
      const resp = await _apiFetch('/api/users/' + userId + '/unlock', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return { ok: true };
        return { ok: false, erro: data.erro || 'Erro' };
      }
    } catch (e) {}

    const users = _loadUsers() || [];
    const user = users.find(u => u.id === userId);
    if (!user) return { ok: false, erro: 'Usuário não encontrado.' };
    user.lockUntil = null;
    user.failedAttempts = 0;
    _saveUsers(users);
    _pushAudit('unlock', userId, null);
    return { ok: true };
  }

  /** Encerra a sessão */
  function logout() {
    _clearSession();
  }

  /** Verifica se o usuário logado pode executar uma ação */
  function can(acao) {
    const session = _getSession();
    if (!session) return false;
    // Overrides carregados do servidor no login e gravados na sessão
    const perms = session.permissions || {};
    if (typeof perms[acao] === 'boolean') return perms[acao];
    const permMap = PERMISSIONS[acao];
    if (!permMap) return false;
    return permMap[session.perfil] === true;
  }

  /** Retorna as permissões efetivas de um usuário (override + padrão do perfil) */
  function getPermissoesEfetivas(userId, perfilUsuario) {
    let overrides = {};
    try {
      const stored = JSON.parse(localStorage.getItem(AUTH_PERMS_KEY) || '{}');
      overrides = stored[userId] || {};
    } catch {}
    const result = {};
    for (const [acao, permMap] of Object.entries(PERMISSIONS)) {
      result[acao] = typeof overrides[acao] === 'boolean'
        ? overrides[acao]
        : (permMap[perfilUsuario] === true);
    }
    return result;
  }

  /** Retorna as permissões padrão de um perfil */
  function getPerfilPadrao(perfilUsuario) {
    const result = {};
    for (const [acao, permMap] of Object.entries(PERMISSIONS)) {
      result[acao] = permMap[perfilUsuario] === true;
    }
    return result;
  }

  /** Salva permissões customizadas para um usuário — persiste no servidor */
  async function salvarPermissoesUsuario(userId, permsObj) {
    if (!can('manageUsers')) return false;
    try {
      const resp = await _apiFetch('/api/users/' + userId + '/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permsObj)
      });
      if (!resp.ok) throw new Error('server error');
    } catch(e) {
      console.warn('auth: falha ao salvar permissões no servidor', e);
      return false;
    }
    // Atualiza cache localStorage só para o painel admin (exibição de outros usuários)
    try {
      const stored = JSON.parse(localStorage.getItem(AUTH_PERMS_KEY) || '{}');
      stored[userId] = permsObj;
      localStorage.setItem(AUTH_PERMS_KEY, JSON.stringify(stored));
    } catch {}
    // Se editou o próprio usuário logado, reflete na sessão imediatamente
    const session = _getSession();
    if (session && session.userId === userId) {
      _saveSession(session, false, permsObj);
    }
    return true;
  }

  /** Lê os overrides salvos para um usuário (para o painel admin) — busca do servidor */
  async function getPermissoesUsuario(userId) {
    try {
      const resp = await _apiFetch('/api/users/' + userId + '/permissions');
      if (!resp.ok) return null;
      const data = await resp.json();
      return (data && data.ok) ? (data.permissions || {}) : null;
    } catch { return null; }
  }

  /**
   * Carrega permissões de todos os usuários do servidor e atualiza o cache local.
   * Chamado após login e periodicamente. Garante que overrides salvos por outro admin
   * se reflitam nesta sessão.
   */
  async function carregarPermissoesServidor(userIds) {
    if (!can('manageUsers')) return;
    if (!userIds || !userIds.length) return;
    try {
      const stored = JSON.parse(localStorage.getItem(AUTH_PERMS_KEY) || '{}');
      await Promise.all(userIds.map(async uid => {
        try {
          const resp = await _apiFetch('/api/users/' + uid + '/permissions');
          if (!resp.ok) return;
          const data = await resp.json();
          if (data && data.ok && data.permissions && Object.keys(data.permissions).length) {
            stored[uid] = data.permissions;
          }
        } catch(e) {}
      }));
      localStorage.setItem(AUTH_PERMS_KEY, JSON.stringify(stored));
    } catch(e) {}
  }

  /** Retorna o perfil do usuário logado */
  function perfil() {
    return _getSession()?.perfil || null;
  }

  // ── CRUD de usuários (apenas admin) ─────────────────────────────────────

  /** Lista todos os usuários */
  async function listarUsuarios() {
    try {
      const resp = await _apiFetch('/api/users', { method: 'GET' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return data.users.map(u => ({ ...u, senha: '***' }));
        return [];
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  /** Cria novo usuário */
  async function criarUsuario({ usuario, nome, senha, perfil }) {
    if (!can('manageUsers')) return { ok: false, erro: 'Sem permissão.' };
    if (!ROLES[perfil]) return { ok: false, erro: 'Perfil inválido.' };
    if (senha.length < 6) return { ok: false, erro: 'Senha muito curta (mínimo 6 caracteres).' };

    try {
      const resp = await _apiFetch('/api/users', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ usuario, nome, senha, perfil }) });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return { ok: true };
        return { ok: false, erro: data.erro || 'Erro' };
      }
      return { ok: false, erro: 'Serviço indisponível.' };
    } catch (e) {
      return { ok: false, erro: 'Serviço indisponível.' };
    }
  }

  /** Altera o perfil de um usuário */
  async function alterarPerfil(userId, novoPerfil) {
    if (!can('manageUsers')) return { ok: false, erro: 'Sem permissão.' };
    if (!ROLES[novoPerfil]) return { ok: false, erro: 'Perfil inválido.' };

    try {
      const resp = await _apiFetch('/api/users/' + userId, { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ perfil: novoPerfil }) });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return { ok: true };
        return { ok: false, erro: data.erro || 'Erro' };
      }
      return { ok: false, erro: 'Serviço indisponível.' };
    } catch (e) {
      return { ok: false, erro: 'Serviço indisponível.' };
    }
  }

  /** Ativa/desativa usuário */
  async function toggleAtivo(userId) {
    if (!can('manageUsers')) return { ok: false, erro: 'Sem permissão.' };
    try {
      const resp = await _apiFetch('/api/users/' + userId + '/toggle', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return { ok: true };
        return { ok: false, erro: data.erro || 'Erro' };
      }
      return { ok: false, erro: 'Serviço indisponível.' };
    } catch (e) {
      return { ok: false, erro: 'Serviço indisponível.' };
    }
  }

  /** Redefine a senha de um usuário */
  async function redefinirSenha(userId, novaSenha) {
    if (!can('manageUsers')) return { ok: false, erro: 'Sem permissão.' };
    if (novaSenha.length < 6) return { ok: false, erro: 'Senha muito curta (mínimo 6 caracteres).' };
    try {
      const resp = await _apiFetch('/api/users/' + userId + '/reset-password', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ nova: novaSenha }) });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return { ok: true };
        return { ok: false, erro: data.erro || 'Erro' };
      }
      return { ok: false, erro: 'Serviço indisponível.' };
    } catch (e) {
      return { ok: false, erro: 'Serviço indisponível.' };
    }
  }

  /** Troca a própria senha */
  async function trocarSenhaPropria(senhaAtual, novaSenha) {
    const session = _getSession();
    if (!session) return { ok: false, erro: 'Sem sessão ativa.' };

    const users = _loadUsers() || [];
    const user  = users.find(u => u.id === session.userId);
    if (!user) return { ok: false, erro: 'Usuário não encontrado.' };

    const hashAtual = await sha256(senhaAtual);
    if (user.senha !== hashAtual) return { ok: false, erro: 'Senha atual incorreta.' };
    if (novaSenha.length < 6)    return { ok: false, erro: 'Nova senha muito curta (mínimo 6 caracteres).' };

    user.senha = await sha256(novaSenha);
    _saveUsers(users);
    return { ok: true };
  }

  /** Remove um usuário */
  async function removerUsuario(userId) {
    if (!can('manageUsers')) return { ok: false, erro: 'Sem permissão.' };
    const session = _getSession();
    if (session?.userId === userId) return { ok: false, erro: 'Não é possível remover o próprio usuário.' };

    try {
      const resp = await _apiFetch('/api/users/' + userId, { method: 'DELETE' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok) return { ok: true };
        return { ok: false, erro: data.erro || 'Erro' };
      }
      return { ok: false, erro: 'Serviço indisponível.' };
    } catch (e) {
      return { ok: false, erro: 'Serviço indisponível.' };
    }
  }

  return {
    init,
    isLoggedIn,
    currentUser,
    login,
    logout,
    can,
    perfil,
    listarUsuarios,
    criarUsuario,
    alterarPerfil,
    toggleAtivo,
    redefinirSenha,
    trocarSenhaPropria,
    removerUsuario,
    getPermissoesEfetivas,
    getPerfilPadrao,
    salvarPermissoesUsuario,
    getPermissoesUsuario,
    carregarPermissoesServidor,
    ROLES,
    PERMISSIONS,
    rememberLogin,
    clearRemember,
    restoreSession,
    listAudit,
  };
})();

// Expõe para outros scripts e para testes automatizados
try {
  window.auth        = auth;
  window.ROLES       = auth.ROLES;
  window.PERMISSIONS = auth.PERMISSIONS;
} catch(e) {}
