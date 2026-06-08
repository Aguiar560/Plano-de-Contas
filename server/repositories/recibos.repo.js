'use strict';

/**
 * RecibosRepo — queries SQL relativas a recibos.
 */
module.exports = function createRecibosRepo({ db }) {
  return {
    /** Máximo número de recibo para empresa+ano (dentro de transação). */
    async maxNumero(conn, empresaId, ano) {
      const [[{ maxNum }]] = await conn.query(
        'SELECT COALESCE(MAX(numero), 0) AS maxNum FROM recibo WHERE empresa_id = ? AND ano = ?',
        [empresaId, ano]
      );
      return maxNum;
    },

    /** Insere recibo. Retorna insertId. */
    async insert(conn, empresaId, numero, ano, fields) {
      const [r] = await conn.query(
        `INSERT INTO recibo
           (empresa_id, numero, ano, lancamento_id, conta_codigo, fornecedor_nome,
            fornecedor_cpf, data, valor, descricao, emitido_por, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [
          empresaId, numero, ano,
          fields.lancamento_id   || null,
          fields.conta_codigo    || null,
          fields.fornecedor_nome,
          fields.fornecedor_cpf  || null,
          fields.data,
          fields.valor,
          fields.descricao       || null,
          fields.emitido_por     || null,
        ]
      );
      return r.insertId;
    },

    /** Assina recibo. Retorna affectedRows. */
    async sign(id, empresaId) {
      const [r] = await db.pool.query(
        'UPDATE recibo SET assinado_em = NOW() WHERE id = ? AND empresa_id = ?',
        [id, empresaId]
      );
      return r.affectedRows;
    },

    /** Remove recibo (hard delete). Retorna affectedRows. */
    async delete(id, empresaId) {
      const [r] = await db.pool.query(
        'DELETE FROM recibo WHERE id = ? AND empresa_id = ?',
        [id, empresaId]
      );
      return r.affectedRows;
    },

    /** Lista paginada com busca opcional. Retorna { rows, total }. */
    async list(empresaId, { ano, page = 1, limit = 50, busca = '' }) {
      let where  = 'WHERE empresa_id = ? AND ano = ?';
      const params = [empresaId, ano];
      if (busca) { where += ' AND fornecedor_nome LIKE ?'; params.push('%' + busca + '%'); }
      const [[{ total }]] = await db.pool.query(`SELECT COUNT(*) AS total FROM recibo ${where}`, params);
      const offset = (page - 1) * limit;
      const rows = await db.query(
        `SELECT id, numero, ano, lancamento_id, conta_codigo, fornecedor_nome, fornecedor_cpf,
                data, valor, descricao, emitido_por, created_at, assinado_em
         FROM recibo ${where} ORDER BY numero DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      return { rows, total: Number(total) };
    },
  };
};
