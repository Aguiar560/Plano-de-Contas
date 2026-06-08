'use strict';

/**
 * FornecedoresRepo — queries SQL relativas a fornecedores.
 */
module.exports = function createFornecedoresRepo({ db }) {
  return {
    /** Lista todos os fornecedores ativos da empresa (exceto excluídos). */
    async listAll(empresaId) {
      return db.query(
        "SELECT * FROM fornecedor WHERE empresa_id = ? AND status != 'excluido' ORDER BY razao_social",
        [empresaId]
      );
    },

    /** Insere fornecedor. Retorna insertId. */
    async insert(row) {
      const [r] = await db.pool.query('INSERT INTO fornecedor SET ?', [row]);
      return r.insertId;
    },

    /**
     * Atualiza fornecedor garantindo empresa_id.
     * Retorna affectedRows.
     */
    async update(id, empresaId, row) {
      const [r] = await db.pool.query(
        'UPDATE fornecedor SET ? WHERE id = ? AND empresa_id = ?',
        [row, id, empresaId]
      );
      return r.affectedRows;
    },

    /** Soft-delete. Retorna affectedRows. */
    async softDelete(id, empresaId) {
      const [r] = await db.pool.query(
        "UPDATE fornecedor SET status='excluido', updated_at=NOW() WHERE id = ? AND empresa_id = ?",
        [id, empresaId]
      );
      return r.affectedRows;
    },
  };
};
