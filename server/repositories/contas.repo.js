'use strict';

/**
 * ContasRepo — todas as queries SQL relativas a contas e sua estrutura.
 * Sem lógica HTTP nem validação de negócio.
 */
module.exports = function createContasRepo({ db }) {
  return {
    /** Hash para ETag: considera apenas timestamps de estrutura (sem lancamentos). */
    async computeHash(empresaId) {
      const [[{ ts }]] = await db.pool.query(`
        SELECT GREATEST(
          COALESCE((SELECT MAX(created_at) FROM conta WHERE empresa_id = ?), '2000-01-01'),
          COALESCE((SELECT MAX(updated_at) FROM conta WHERE empresa_id = ?), '2000-01-01'),
          COALESCE((SELECT MAX(deleted_at) FROM conta WHERE empresa_id = ?), '2000-01-01')
        ) AS ts
      `, [empresaId, empresaId, empresaId]);
      return ts ? (ts instanceof Date ? String(ts.getTime()) : String(ts)) : '0';
    },

    /** Lista todas as contas ativas da empresa — apenas estrutura, sem lancamentos. */
    async listAll(empresaId) {
      return db.query(
        'SELECT id, parent_id, codigo, nome, natureza, orcamento, ordem FROM conta WHERE empresa_id = ? AND deleted_at IS NULL ORDER BY codigo',
        [empresaId]
      );
    },

    /**
     * Busca conta pelo código. Usa FOR UPDATE (dentro de conn) para lock transacional.
     * @param {object|null} conn — conexão aberta ou null para usar db diretamente.
     */
    async findByCodigo(empresaId, codigo, conn) {
      const [[row]] = conn
        ? await conn.query('SELECT id, codigo, nome FROM conta WHERE empresa_id = ? AND codigo = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [empresaId, codigo])
        : await db.pool.query('SELECT id, codigo, nome FROM conta WHERE empresa_id = ? AND codigo = ? AND deleted_at IS NULL LIMIT 1', [empresaId, codigo]);
      return row || null;
    },

    /** Máximo segmento filho de um pai (para gerar código sequencial). */
    async maxChildSegment(empresaId, parentId, conn) {
      const [[{ maxSeg }]] = await (conn || db.pool).query(
        "SELECT MAX(CAST(SUBSTRING_INDEX(codigo, '.', -1) AS UNSIGNED)) AS maxSeg FROM conta WHERE empresa_id = ? AND parent_id = ?",
        [empresaId, parentId]
      );
      return maxSeg || 0;
    },

    /** Máximo segmento raiz (para gerar código sequencial na raiz). */
    async maxRootSegment(empresaId, conn) {
      const [[{ maxSeg }]] = await (conn || db.pool).query(
        'SELECT MAX(CAST(codigo AS UNSIGNED)) AS maxSeg FROM conta WHERE empresa_id = ? AND parent_id IS NULL',
        [empresaId]
      );
      return maxSeg || 0;
    },

    /** Conta filhas ativas de um nó. */
    async countChildren(conn, empresaId, parentId) {
      const [[{ qtd }]] = await (conn || db.pool).query(
        'SELECT COUNT(*) AS qtd FROM conta WHERE empresa_id = ? AND parent_id = ? AND deleted_at IS NULL',
        [empresaId, parentId]
      );
      return qtd;
    },

    /** Insere nova conta. Usa conn para transação. Retorna insertId. */
    async insert(conn, empresaId, parentId, codigo, nome, natureza) {
      const [r] = await conn.execute(
        'INSERT INTO conta (empresa_id, parent_id, codigo, nome, natureza, created_at) VALUES (?,?,?,?,?,NOW())',
        [empresaId, parentId, codigo, nome, natureza]
      );
      return r.insertId;
    },

    /**
     * Atualiza campos da conta dentro de uma transação.
     * fields: { nome?, orcamento? }
     */
    async updateFields(conn, id, empresaId, fields) {
      const sets   = [];
      const params = [];
      if (fields.nome      !== undefined) { sets.push('nome = ?');      params.push(fields.nome); }
      if (fields.orcamento !== undefined) { sets.push('orcamento = ?'); params.push(fields.orcamento ?? null); }
      sets.push('updated_at = NOW()');
      params.push(id, empresaId);
      const [r] = await conn.execute(
        `UPDATE conta SET ${sets.join(', ')} WHERE id = ? AND empresa_id = ?`,
        params
      );
      return r.affectedRows;
    },

    /** Soft-delete de uma conta (e seus lancamentos, se chamado em transação). */
    async softDelete(conn, id, empresaId) {
      await conn.execute(
        'UPDATE conta SET deleted_at = NOW() WHERE id = ? AND empresa_id = ?',
        [id, empresaId]
      );
    },

    /** Soft-delete de todos os lancamentos de uma conta (cascata no delete da conta). */
    async softDeleteLancamentos(conn, empresaId, contaId) {
      await conn.execute(
        'UPDATE lancamento SET deleted_at = NOW() WHERE empresa_id = ? AND conta_id = ? AND deleted_at IS NULL',
        [empresaId, contaId]
      );
    },
  };
};
