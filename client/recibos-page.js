'use strict';

(function () {
  let _recibosPagAtual = 1;
  let _recibosAtual    = [];   // cache da última página carregada
  let _listenersAtivos = false;
  const RECIBOS_POR_PAG = 20;

  function _fmtData(val) {
    if (!val) return '—';
    const d = new Date(val);
    return isNaN(d) ? val : d.toLocaleDateString('pt-BR');
  }

  function _fmtMoeda(v) {
    return (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _popularAnos() {
    const sel = document.getElementById('recibosAnoFiltro');
    if (!sel || sel.options.length > 0) return; // já populado
    const atual = new Date().getFullYear();
    for (let a = atual; a >= atual - 5; a--) {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      sel.appendChild(opt);
    }
  }

  async function _carregarRecibos() {
    const tbody = document.getElementById('recibosTableBody');
    const pag   = document.getElementById('recibosPaginacao');
    if (!tbody) return;

    const ano   = document.getElementById('recibosAnoFiltro')?.value || new Date().getFullYear();
    const busca = (document.getElementById('recibosSearchInput')?.value || '').trim();

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8">Carregando…</td></tr>';

    try {
      const params = new URLSearchParams({ ano, page: _recibosPagAtual, limit: RECIBOS_POR_PAG });
      if (busca) params.set('busca', busca);

      const resp = await fetch(apiUrl('/api/recibos?' + params), { credentials: 'include' });
      const j    = await resp.json();

      if (!j.ok) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#ef4444">${j.erro || 'Erro ao carregar'}</td></tr>`;
        return;
      }

      _recibosAtual = j.recibos || [];

      if (_recibosAtual.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8">Nenhum recibo emitido neste período.</td></tr>';
        if (pag) pag.innerHTML = '';
        return;
      }

      tbody.innerHTML = _recibosAtual.map(r => {
        const numFmt     = String(r.numero).padStart(4, '0') + '/' + r.ano;
        const assinado   = !!r.assinado_em;
        const statusHtml = assinado
          ? `<span style="display:inline-flex;align-items:center;gap:5px;color:#16a34a;font-weight:600;font-size:12px">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
               ${_fmtData(r.assinado_em)}
             </span>`
          : `<button class="btn-assinar" data-id="${r.id}"
               style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
               Confirmar assinatura
             </button>`;

        return `<tr>
          <td style="font-weight:600">${numFmt}</td>
          <td>${_fmtData(r.data)}</td>
          <td>${r.fornecedor_nome || '—'}</td>
          <td style="color:#64748b">${r.fornecedor_cpf || '—'}</td>
          <td style="text-align:right;font-weight:600">R$ ${_fmtMoeda(r.valor)}</td>
          <td style="text-align:center">${statusHtml}</td>
          <td style="text-align:center">
            <button class="btn-reimprimir" data-id="${r.id}" title="Reimprimir"
              style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px;border-radius:4px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            </button>
          </td>
        </tr>`;
      }).join('');

      // Paginação
      if (pag) {
        const totalPags = Math.ceil(j.total / RECIBOS_POR_PAG);
        pag.innerHTML = '';
        if (totalPags > 1) {
          for (let p = 1; p <= totalPags; p++) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm ' + (p === _recibosPagAtual ? 'btn-primary' : 'btn-outline');
            btn.textContent = p;
            btn.addEventListener('click', () => { _recibosPagAtual = p; _carregarRecibos(); });
            pag.appendChild(btn);
          }
        }
      }

      // Bind botões — tbody é recriado a cada load, não há duplicação
      tbody.querySelectorAll('.btn-assinar').forEach(btn => {
        btn.addEventListener('click', () => _confirmarAssinatura(+btn.dataset.id, btn));
      });
      tbody.querySelectorAll('.btn-reimprimir').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = _recibosAtual.find(x => x.id === +btn.dataset.id);
          if (r) _reimprimirRecibo(r);
        });
      });

    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#ef4444">Sem conexão com o servidor.</td></tr>';
    }
  }

  function _reimprimirRecibo(r) {
    if (typeof abrirReciboAutonomo !== 'function') {
      if (typeof showToast === 'function') showToast('Função de recibo não disponível.', 'error');
      return;
    }
    let forn = null;
    if (typeof window.fornRepo !== 'undefined') {
      const todos = window.fornRepo.listar();
      forn = (r.fornecedor_cpf && todos.find(f => f.cpf === r.fornecedor_cpf))
          || (r.fornecedor_nome && todos.find(f => f.razaoSocial === r.fornecedor_nome))
          || null;
    }
    if (!forn) {
      forn = {
        tipoPessoa: 'fisica', razaoSocial: r.fornecedor_nome || '',
        cpf: r.fornecedor_cpf || '', rg: '', inssPis: '',
        tituloEleitor: '', dataNascimento: '',
        logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
      };
    }
    abrirReciboAutonomo({
      lancamento:      { id: r.lancamento_id || null, tipo: 'debito', valor: parseFloat(r.valor) || 0, descricao: r.descricao || '', data: (r.data || '').split('T')[0] },
      conta:           r.conta_codigo ? { codigo: r.conta_codigo, nome: r.descricao || '' } : null,
      fornecedor:      forn,
      reciboFormatted: String(r.numero).padStart(4, '0') + '/' + r.ano,
    });
  }

  async function _confirmarAssinatura(id, btn) {
    const _doConfirm = (cb) => {
      if (typeof confirmar === 'function') {
        confirmar('Confirmar Assinatura', 'O autônomo assinou o recibo fisicamente?', cb, { confirmLabel: 'Confirmar', confirmClass: 'btn-primary' });
      } else if (confirm('O autônomo assinou o recibo fisicamente?')) {
        cb();
      }
    };

    _doConfirm(async () => {
      btn.disabled    = true;
      btn.textContent = 'Aguarde…';
      try {
        const resp = await fetch(apiUrl('/api/recibos/' + id + '/assinar'), { method: 'PUT', credentials: 'include' });
        const j    = await resp.json();
        if (j.ok) {
          if (typeof showToast === 'function') showToast('Assinatura confirmada!', 'success');
          _carregarRecibos();
        } else {
          if (typeof showToast === 'function') showToast(j.erro || 'Erro ao confirmar', 'error');
          btn.disabled    = false;
          btn.textContent = 'Confirmar assinatura';
        }
      } catch {
        if (typeof showToast === 'function') showToast('Sem conexão com o servidor.', 'error');
        btn.disabled    = false;
        btn.textContent = 'Confirmar assinatura';
      }
    });
  }

  function initRecibosPage() {
    _popularAnos();
    _recibosPagAtual = 1;
    _carregarRecibos();

    // Bind filtros uma única vez
    if (!_listenersAtivos) {
      _listenersAtivos = true;
      document.getElementById('recibosAnoFiltro')?.addEventListener('change', () => { _recibosPagAtual = 1; _carregarRecibos(); });
      document.getElementById('recibosSearchInput')?.addEventListener('input',  () => { _recibosPagAtual = 1; _carregarRecibos(); });
    }
  }

  window.initRecibosPage = initRecibosPage;
})();
