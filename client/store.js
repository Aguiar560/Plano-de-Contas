'use strict';

/**
 * store.js — Módulo de estado controlado do plano de contas.
 *
 * Encapsula o acesso a window.repo com getter/setter controlado e
 * pub-sub para notificação de mudanças. Mantém window.repo como
 * propriedade acessível para compatibilidade com código existente.
 */
(function () {
  const _subscribers = [];

  const store = {
    /** Acessa o repositório atual */
    get repo() { return window._repoInstance; },

    /** Substitui o repositório e notifica subscribers */
    set repo(value) {
      window._repoInstance = value;
      _subscribers.forEach(fn => { try { fn(value); } catch (e) { /* isolado */ } });
    },

    /** Registra callback chamado quando o repo é substituído. Retorna função de cancelamento. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      _subscribers.push(fn);
      return () => {
        const i = _subscribers.indexOf(fn);
        if (i >= 0) _subscribers.splice(i, 1);
      };
    },

    /** Dispara notificação sem substituir o repo (ex: após carregarDoBanco). */
    notify() {
      const r = window._repoInstance;
      _subscribers.forEach(fn => { try { fn(r); } catch (e) { /* isolado */ } });
    },
  };

  // Expõe store globalmente
  window.store = store;

  // Mantém window.repo como proxy compatível: leitura e escrita passam pelo store
  try {
    Object.defineProperty(window, 'repo', {
      get() { return window._repoInstance; },
      set(value) { store.repo = value; },
      configurable: true,
    });
  } catch (e) {
    // Fallback se defineProperty não funcionar (ex: modo restrito de teste)
    window.repo = window._repoInstance;
  }
})();
