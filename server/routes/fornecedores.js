'use strict';

const express = require('express');

/**
 * fornecedoresRoutes — lógica HTTP para /api/fornecedores.
 * SQL extraído para fornecedoresRepo (injetado).
 */
module.exports = function fornecedoresRoutes({
  db, logger, Joi,
  readLimiter, writeLimiter,
  jwtMiddleware, requireRole,
  cryptoUtils,
  fornecedoresRepo,
}) {
  const router = express.Router();
  const { encrypt, decrypt } = cryptoUtils;

  const _schema = Joi.object({
    tipoPessoa:   Joi.string().valid('fisica','juridica').required(),
    razaoSocial:  Joi.string().max(200).required(),
    nomeFantasia: Joi.string().max(200).allow('', null).optional(),
    cnpj:         Joi.string().max(20).allow('', null).optional(),
    cpf:          Joi.string().max(20).allow('', null).optional(),
    status:       Joi.string().valid('ativo','inativo').default('ativo'),
  }).unknown(true);

  function _toRow(body, empresaId) {
    const dados = { ...body };
    delete dados.cpf;
    delete dados.cnpj;
    const row = {
      tipo_pessoa:   body.tipoPessoa  || 'juridica',
      razao_social:  body.razaoSocial || '',
      nome_fantasia: body.nomeFantasia || null,
      cnpj:          body.cnpj  ? encrypt(body.cnpj)  : null,
      cpf:           body.cpf   ? encrypt(body.cpf)   : null,
      status:        body.status || 'ativo',
      dados:         JSON.stringify(dados),
    };
    if (empresaId) row.empresa_id = empresaId;
    return row;
  }

  function _fromRow(row) {
    try {
      const dados = JSON.parse(row.dados || '{}');
      // CPF/CNPJ vêm APENAS das colunas criptografadas
      const cpf  = decrypt(row.cpf)  ?? null;
      const cnpj = decrypt(row.cnpj) ?? null;
      return { ...dados, id: row.id, status: row.status, cpf, cnpj };
    } catch { return { id: row.id, status: row.status }; }
  }

  router.get('/fornecedores', readLimiter, jwtMiddleware, requireRole('visualizador'), async (req, res) => {
    if (!db) return res.json({ ok:true, fornecedores:[] });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    try {
      const rows = await fornecedoresRepo.listAll(empresaId);
      res.json({ ok:true, fornecedores: rows.map(_fromRow) });
    } catch(e) {
      logger.error('GET /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao listar fornecedores' });
    }
  });

  router.post('/fornecedores', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const { error, value } = _schema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      const row = _toRow(value, empresaId);
      row.created_at = new Date();
      row.updated_at = new Date();
      const id = await fornecedoresRepo.insert(row);
      res.json({ ok:true, id, fornecedor: { ...value, id } });
    } catch(e) {
      logger.error('POST /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao salvar fornecedor' });
    }
  });

  router.put('/fornecedores/:id', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    const { error, value } = _schema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      const row = _toRow(value);
      row.updated_at = new Date();
      const affected = await fornecedoresRepo.update(id, empresaId, row);
      if (affected === 0) return res.status(404).json({ ok:false, erro:'Fornecedor não encontrado' });
      res.json({ ok:true });
    } catch(e) {
      logger.error('PUT /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao atualizar fornecedor' });
    }
  });

  router.delete('/fornecedores/:id', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    try {
      const affected = await fornecedoresRepo.softDelete(id, empresaId);
      if (affected === 0) return res.status(404).json({ ok:false, erro:'Fornecedor não encontrado' });
      res.json({ ok:true });
    } catch(e) {
      logger.error('DELETE /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao excluir fornecedor' });
    }
  });

  return router;
};
