'use strict';

const express = require('express');

module.exports = function fornecedoresRoutes({ db, logger, Joi, readLimiter, writeLimiter, jwtMiddleware, requireRole, cryptoUtils }) {
  const router = express.Router();
  const { encrypt, decrypt } = cryptoUtils;

  const _fornSchema = Joi.object({
    tipoPessoa:   Joi.string().valid('fisica','juridica').required(),
    razaoSocial:  Joi.string().max(200).required(),
    nomeFantasia: Joi.string().max(200).allow('', null).optional(),
    cnpj:         Joi.string().max(20).allow('',null).optional(),
    cpf:          Joi.string().max(20).allow('',null).optional(),
    status:       Joi.string().valid('ativo','inativo').default('ativo'),
  }).unknown(true);

  function _fornRow(body, empresaId) {
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

  function _fornFromRow(row) {
    try {
      const dados = JSON.parse(row.dados || '{}');
      // CPF/CNPJ vêm APENAS das colunas criptografadas.
      // dados.cpf/dados.cnpj são removidos pela migração _migrateEncryptCpf() no startup;
      // não usar como fallback impede vazar dados em claro se ENCRYPT_KEY for rotacionada.
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
      const rows = await db.query(
        "SELECT * FROM fornecedor WHERE empresa_id = ? AND status != ? ORDER BY razao_social",
        [empresaId, 'excluido']
      );
      res.json({ ok:true, fornecedores: rows.map(_fornFromRow) });
    } catch(e) {
      logger.error('GET /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao listar fornecedores' });
    }
  });

  router.post('/fornecedores', writeLimiter, jwtMiddleware, requireRole('operador'), async (req, res) => {
    if (!db) return res.status(501).json({ ok:false, erro:'DB disabled' });
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const { error, value } = _fornSchema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      const row = _fornRow(value, empresaId);
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
    const empresaId = req.user.empresaId;
    if (!empresaId) return res.status(403).json({ ok:false, erro:'Sem empresa associada' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok:false, erro:'ID inválido' });
    const { error, value } = _fornSchema.validate(req.body);
    if (error) return res.status(400).json({ ok:false, erro: error.details[0].message });
    try {
      const row = _fornRow(value);
      row.updated_at = new Date();
      const [r] = await db.pool.query('UPDATE fornecedor SET ? WHERE id = ? AND empresa_id = ?', [row, id, empresaId]);
      if (r.affectedRows === 0) return res.status(404).json({ ok:false, erro:'Fornecedor não encontrado' });
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
      const [r] = await db.pool.query(
        "UPDATE fornecedor SET status='excluido', updated_at=NOW() WHERE id = ? AND empresa_id = ?",
        [id, empresaId]
      );
      if (r.affectedRows === 0) return res.status(404).json({ ok:false, erro:'Fornecedor não encontrado' });
      res.json({ ok:true });
    } catch(e) {
      logger.error('DELETE /api/fornecedores falhou', { err: e && e.message });
      res.status(500).json({ ok:false, erro:'Erro ao excluir fornecedor' });
    }
  });

  return router;
};
