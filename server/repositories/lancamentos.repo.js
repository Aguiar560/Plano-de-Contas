'use strict';

/**
 * LancamentosRepo — todas as queries SQL relativas a lançamentos.
 * Sem lógica HTTP nem validação de negócio.
 */
module.exports = function createLancamentosRepo({ db }) {
  const ORDER_MAP = {
    'data-desc':  'l.data DESC, l.id DESC',
    'data-asc':   'l.data ASC,  l.id ASC',
    'valor-desc': 'l.valor DESC',
    'valor-asc':  'l.valor ASC',
  };

  return {
    /**
     * Lista paginada por conta_id. Retorna { rows, total }.
     * opts: { dtI?, dtF?, busca?, ordem?, page, limit }
     */
    async listByContaId(empresaId, contaId, opts = {}) {
      const { dtI, dtF, busca, ordem = 'data-desc', page = 1, limit = 50 } = opts;
      const orderBy = ORDER_MAP[ordem] || ORDER_MAP['data-desc'];
      const where  = ['l.empresa_id = ?', 'l.conta_id = ?', 'l.deleted_at IS NULL'];
      const params = [empresaId, contaId];

      if (dtI)          { where.push('l.data >= ?');         params.push(dtI); }
      if (dtF)          { where.push('l.data <= ?');         params.push(dtF); }
      if (busca?.trim()) { where.push('l.descricao LIKE ?'); params.push(`%${busca.trim()}%`); }

      const whereStr = where.join(' AND ');
      const [[{ total }]] = await db.pool.query(
        `SELECT COUNT(*) AS total FROM lancamento l WHERE ${whereStr}`,
        params
      );
      const offset = (page - 1) * limit;
      const rows = await db.query(
        `SELECT l.id, l.conta_id, l.data, l.tipo, l.valor, l.descricao, l.fornecedor_id
         FROM lancamento l WHERE ${whereStr} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      return { rows, total: Number(total) };
    },

    /**
     * Todos os lançamentos da empresa para um ano, ordenados por data.
     * Usado pelo endpoint CQRS GET /api/lancamentos?ano=XXXX.
     * @param {number} limit — máximo de registros (default: cfg.limits.lancamentosPerYear)
     * @returns {{ rows: Array, truncated: boolean }}
     */
    async listByYear(empresaId, ano, limit = 5000) {
      const rows = await db.query(
        'SELECT id, conta_id, data, tipo, valor, descricao, fornecedor_id FROM lancamento WHERE empresa_id = ? AND deleted_at IS NULL AND YEAR(data) = ? ORDER BY data, id LIMIT ?',
        [empresaId, ano, limit + 1]
      );
      const truncated = rows.length > limit;
      return { rows: truncated ? rows.slice(0, limit) : rows, truncated };
    },

    /** Verifica se uma conta pertence à empresa pelo id (para import em lote). */
    async findContaById(empresaId, contaId) {
      const rows = await db.query(
        'SELECT id FROM conta WHERE empresa_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
        [empresaId, contaId]
      );
      return rows.length ? rows[0] : null;
    },

    /**
     * Retorna o Set de fit_ids já existentes para (empresa, conta) dentre os
     * fornecidos. Usado para deduplicar importação OFX/CSV.
     */
    async existingFitIds(empresaId, contaId, fitIds) {
      const ids = fitIds.filter(Boolean);
      if (!ids.length) return new Set();
      const placeholders = ids.map(() => '?').join(',');
      const rows = await db.query(
        `SELECT fit_id FROM lancamento WHERE empresa_id = ? AND conta_id = ? AND fit_id IN (${placeholders})`,
        [empresaId, contaId, ...ids]
      );
      return new Set(rows.map(r => r.fit_id));
    },

    /**
     * Insere vários lançamentos numa única instrução. INSERT IGNORE protege
     * contra corrida com o índice único (ux_lanc_empresa_conta_fit).
     * rows: [{ data, tipo, valor, descricao, fitId }]
     * Retorna { inserted } (affectedRows reais).
     */
    async bulkInsert(empresaId, contaId, rows) {
      if (!rows.length) return { inserted: 0 };
      const placeholders = rows.map(() => '(?,?,?,?,?,?,?,NOW())').join(',');
      const params = [];
      for (const r of rows) {
        params.push(empresaId, contaId, r.data, r.tipo, r.valor, r.descricao || null, r.fitId || null);
      }
      const res = await db.execute(
        `INSERT IGNORE INTO lancamento
           (empresa_id, conta_id, data, tipo, valor, descricao, fit_id, created_at)
         VALUES ${placeholders}`,
        params
      );
      return { inserted: res.affectedRows };
    },

    /** Verifica se uma conta pertence à empresa (para GET lista). */
    async findContaForQuery(empresaId, contaId) {
      const rows = await db.query(
        'SELECT id FROM conta WHERE empresa_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
        [empresaId, contaId]
      );
      return rows.length ? rows[0] : null;
    },

    /** Busca conta pelo código (sem lock). */
    async findContaByCodigo(empresaId, codigo) {
      const rows = await db.query(
        'SELECT id FROM conta WHERE empresa_id = ? AND codigo = ? LIMIT 1',
        [empresaId, String(codigo)]
      );
      return rows.length ? rows[0] : null;
    },

    /** Busca conta pelo ext_id/codigo (sem lock). */
    async findContaByExtId(empresaId, extId) {
      const rows = await db.query(
        'SELECT id FROM conta WHERE empresa_id = ? AND codigo = ? LIMIT 1',
        [empresaId, extId]
      );
      return rows.length ? rows[0] : null;
    },

    /** Busca conta pai para auto-criação de conta filho. */
    async findContaPai(empresaId, codigoPai) {
      const rows = await db.query(
        'SELECT id FROM conta WHERE empresa_id = ? AND codigo = ? LIMIT 1',
        [empresaId, codigoPai]
      );
      return rows.length ? rows[0] : null;
    },

    /** Auto-cria conta via código externo (import). Retorna insertId. */
    async insertConta(empresaId, parentId, codigo, nome, natureza) {
      const r = await db.execute(
        'INSERT INTO conta (empresa_id, parent_id, codigo, nome, natureza, created_at) VALUES (?,?,?,?,?,NOW())',
        [empresaId, parentId, codigo, String(nome).toUpperCase().trim(), natureza]
      );
      return r.insertId;
    },

    /** Insere lançamento. Retorna insertId. */
    async insert(empresaId, contaId, data, tipo, valor, descricao, fornecedorId) {
      const r = await db.execute(
        'INSERT INTO lancamento (empresa_id, conta_id, data, tipo, valor, descricao, fornecedor_id, created_at) VALUES (?,?,?,?,?,?,?,NOW())',
        [empresaId, contaId, data, tipo, valor, descricao || null, fornecedorId || null]
      );
      return r.insertId;
    },

    /**
     * Busca lançamento pelo id com FOR UPDATE (transação).
     * Retorna null se não encontrado ou empresa errada.
     */
    async findByIdForUpdate(conn, empresaId, id) {
      const [[row]] = await conn.query(
        'SELECT id, data, tipo, valor, descricao, fornecedor_id FROM lancamento WHERE empresa_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [empresaId, id]
      );
      return row || null;
    },

    /** Valida fornecedor pertence à empresa (para PUT). */
    async findFornecedor(empresaId, fornecedorId) {
      const [[forn]] = await db.pool.query(
        "SELECT id FROM fornecedor WHERE id = ? AND empresa_id = ? AND status != 'excluido' LIMIT 1",
        [fornecedorId, empresaId]
      );
      return forn || null;
    },

    /** Atualiza lançamento dentro de transação. */
    async update(conn, id, empresaId, { data, tipo, valor, descricao, fornecedorId }) {
      await conn.execute(
        'UPDATE lancamento SET data=?, tipo=?, valor=?, descricao=?, fornecedor_id=?, updated_at=NOW() WHERE id=? AND empresa_id=?',
        [data, tipo, valor, descricao || null, fornecedorId, id, empresaId]
      );
    },

    /** Verifica existência antes do delete. */
    async exists(empresaId, id) {
      const rows = await db.query(
        'SELECT id FROM lancamento WHERE empresa_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
        [empresaId, id]
      );
      return rows.length > 0;
    },

    /** Soft-delete. */
    async softDelete(empresaId, id) {
      await db.execute(
        'UPDATE lancamento SET deleted_at = NOW() WHERE id = ? AND empresa_id = ?',
        [id, empresaId]
      );
    },
  };
};
