'use strict';

const express = require('express');

module.exports = function fornecedoresRoutes({ db, logger, Joi, readLimiter, writeLimiter, jwtMiddleware, requireRole }) {
  const router = express.Router();

  const _fornSchema = Joi.object({
    tipoPessoa:    Joi.string().valid('fisica','juridica').required(),
    razaoSocial:   Joi.string().max(200).required(),
    nomeFantasia:  Joi.string().max(200).allow('', null).optional(),
    cnpj:          Joi.string().max(20).allow('',null).optional(),
    cpf:           Joi.string().max(20).allow('',null).optional(),
    status:        Joi.string().valid('ativo','inativo').default('ativo'),
  }).unknown(true);

  function _fornRow(body) {
    return {
      tipo_pessoa:   body.tipoPessoa  || 'juridica',
      razao_social:  body.razaoSocial || '',
      nome_fantasia: body.nomeFantasia || null,
      cnpj:          body.cnpj  || null,
      cpf:           body.cpf   || null,
      status:        body.status || 'ativo',
      dados:         JSON.stringify(body),
    };
  }

  function _fornFromRow(row) {
    try {
      const dados = JSON.parse(row.dados || '{}');
      return { ...dados, id: row.id, status: row.status };
    } catch { return { id: row.id, status: row.status }; }
  }

  router.get('/fornecedores', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.json({ ok:true, fornecedores:[] });
    try {
      const rows = await db.query('SELECT * FROM fornecedor WHERE status != ? ORDER BY razao_social', ['excluido']);
      res.json({ ok:true, fornecedores: rows.map(_fornFromRow) });
    } catch(e) {
      logger.error('GET /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao listar fornecedores' });
    }
  });

  router.post('/fornecedores', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const { error, value } = _fornSchema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      const row = _fornRow(value);
      row.created_at = new Date();
      row.updated_at = new Date();
      const [ins] = await db.pool.query('INSERT INTO fornecedor SET ?', [row]);
      res.json({ ok:true, id: ins.insertId, fornecedor: { ...value, id: ins.insertId } });
    } catch(e) {
      logger.error('POST /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao salvar fornecedor' });
    }
  });

  router.put('/fornecedores/:id', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    const { error, value } = _fornSchema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      const row = _fornRow(value);
      row.updated_at = new Date();
      const [r] = await db.pool.query('UPDATE fornecedor SET ? WHERE id = ?', [row, id]);
      if (r.affectedRows === 0) return res.status(404).json({ ok:false, erro:'Fornecedor não encontrado' });
      res.json({ ok:true });
    } catch(e) {
      logger.error('PUT /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao atualizar fornecedor' });
    }
  });

  router.delete('/fornecedores/:id', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    try {
      const [r] = await db.pool.query("UPDATE fornecedor SET status='excluido', updated_at=NOW() WHERE id=?", [id]);
      if (r.affectedRows === 0) return res.status(404).json({ ok:false, erro:'Fornecedor não encontrado' });
      res.json({ ok:true });
    } catch(e) {
      logger.error('DELETE /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao excluir fornecedor' });
    }
  });

  return router;
};
