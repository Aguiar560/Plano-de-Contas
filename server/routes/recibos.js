'use strict';

const express = require('express');

/**
 * recibosRoutes — lógica HTTP para /api/recibos.
 * SQL extraído para recibosRepo (injetado).
 */
module.exports = function recibosRoutes({
  db, logger, Joi,
  readLimiter, writeLimiter,
  jwtMiddleware, requireRole,
  cryptoUtils,
  recibosRepo,
}) {
  const router = express.Router();
  const { encrypt, decrypt } = cryptoUtils;

  router.post('/recibos', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const schema = Joi.object({
      lancamento_id:   Joi.number().integer().positive().optional(),
      conta_codigo:    Joi.string().max(64).optional().allow('', null),
      fornecedor_nome: Joi.string().max(200).required(),
      fornecedor_cpf:  Joi.string().max(20).optional().allow('', null),
      data:            Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      valor:           Joi.number().positive().required(),
      descricao:       Joi.string().max(500).optional().allow('', null),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });

    try {
      const ano  = new Date(value.data + 'T00:00:00').getFullYear();
      const conn = await db.pool.getConnection();
      try {
        await conn.beginTransaction();
        const maxNum = await recibosRepo.maxNumero(conn, empresaId, ano);
        const numero = maxNum + 1;
        const id = await recibosRepo.insert(conn, empresaId, numero, ano, {
          lancamento_id:   value.lancamento_id || null,
          conta_codigo:    value.conta_codigo  || null,
          fornecedor_nome: value.fornecedor_nome,
          fornecedor_cpf:  value.fornecedor_cpf ? encrypt(value.fornecedor_cpf) : null,
          data:            value.data,
          valor:           value.valor,
          descricao:       value.descricao || null,
          emitido_por:     req.user.userId || null,
        });
        await conn.commit();
        const formatted = String(numero).padStart(4, '0') + '/' + ano;
        res.json({ ok:true, id, numero, ano, formatted });
      } catch(e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch(e) {
      logger.error('POST /api/recibos falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao registrar recibo' });
    }
  });

  router.put('/recibos/:id/assinar', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    try {
      const affected = await recibosRepo.sign(id, empresaId);
      if (affected === 0) return res.status(404).json({ ok:false, erro:'Recibo não encontrado' });
      res.json({ ok:true });
    } catch(e) {
      logger.error('PUT /api/recibos/:id/assinar falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao confirmar assinatura' });
    }
  });

  router.delete('/recibos/:id', writeLimiter, jwtMiddleware, requireRole('admin'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    try {
      const affected = await recibosRepo.delete(id, empresaId);
      if (affected === 0) return res.status(404).json({ ok:false, erro:'Recibo não encontrado' });
      res.json({ ok:true });
    } catch(e) {
      logger.error('DELETE /api/recibos/:id falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao excluir recibo' });
    }
  });

  router.get('/recibos', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });

    const ano   = parseInt(req.query.ano,   10) || new Date().getFullYear();
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const busca = (req.query.busca || '').trim().substring(0, 100);

    try {
      const { rows, total } = await recibosRepo.list(empresaId, { ano, page, limit, busca });
      const recibos = rows.map(r => ({ ...r, fornecedor_cpf: decrypt(r.fornecedor_cpf) }));
      res.json({ ok:true, total, page, limit, recibos });
    } catch(e) {
      logger.error('GET /api/recibos falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao listar recibos' });
    }
  });

  return router;
};
