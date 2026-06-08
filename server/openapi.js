'use strict';

/**
 * openapi.js — Especificação OpenAPI 3.0 do Plano de Contas.
 * Servida em GET /api/docs (Swagger UI) e GET /api/openapi.json (spec raw).
 */

const pkg = (() => { try { return require('../package.json'); } catch(e) { return {}; } })();

module.exports = {
  openapi: '3.0.3',
  info: {
    title:   'Plano de Contas API',
    version: pkg.version || '1.0.0',
    description: 'API multi-tenant para gestão de plano de contas gerencial, lançamentos, fornecedores e recibos.',
  },
  servers: [
    { url: '/api/v1', description: 'v1 (atual)' },
    { url: '/api',    description: 'Legacy (sem versão)' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'auth_token' },
    },
    schemas: {
      Ok:    { type: 'object', properties: { ok: { type: 'boolean', example: true } } },
      Erro:  { type: 'object', properties: { ok: { type: 'boolean', example: false }, erro: { type: 'string' } } },
      Conta: {
        type: 'object',
        properties: {
          id:       { type: 'integer' },
          codigo:   { type: 'string', example: '1.2' },
          nome:     { type: 'string', example: 'DESPESAS ADMINISTRATIVAS' },
          natureza: { type: 'string', enum: ['entrada', 'saida'] },
          orcamento:{ type: 'number', example: 10000.00 },
          filhos:   { type: 'array', items: { $ref: '#/components/schemas/Conta' } },
        },
      },
      Lancamento: {
        type: 'object',
        properties: {
          id:           { type: 'integer' },
          conta_id:     { type: 'integer' },
          tipo:         { type: 'string', enum: ['credito', 'debito'] },
          valor:        { type: 'number', example: 150.00 },
          descricao:    { type: 'string', example: 'Pagamento de aluguel' },
          data:         { type: 'string', format: 'date', example: '2026-06-01' },
          fornecedor_id:{ type: 'integer', nullable: true },
        },
      },
      Fornecedor: {
        type: 'object',
        properties: {
          id:           { type: 'integer' },
          tipoPessoa:   { type: 'string', enum: ['fisica', 'juridica'] },
          razaoSocial:  { type: 'string' },
          nomeFantasia: { type: 'string', nullable: true },
          cnpj:         { type: 'string', nullable: true },
          cpf:          { type: 'string', nullable: true },
          status:       { type: 'string', enum: ['ativo', 'inativo'] },
        },
      },
      Recibo: {
        type: 'object',
        properties: {
          id:              { type: 'integer' },
          numero:          { type: 'integer' },
          ano:             { type: 'integer' },
          fornecedor_nome: { type: 'string' },
          fornecedor_cpf:  { type: 'string', nullable: true },
          data:            { type: 'string', format: 'date' },
          valor:           { type: 'number' },
          descricao:       { type: 'string', nullable: true },
          assinado_em:     { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  },
  security: [{ cookieAuth: [] }],
  paths: {
    // ── Auth ──────────────────────────────────────────────────────────────
    '/login': {
      post: {
        tags: ['Auth'], summary: 'Login', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['usuario', 'senha'],
            properties: {
              usuario:   { type: 'string' },
              senha:     { type: 'string' },
              empresaId: { type: 'integer' },
            },
          }}},
        },
        responses: {
          200: { description: 'Login bem-sucedido', content: { 'application/json': { schema: {
            type: 'object', properties: { ok: { type: 'boolean' }, user: { type: 'object' } },
          }}}},
          401: { description: 'Credenciais inválidas' },
        },
      },
    },
    '/logout': {
      post: {
        tags: ['Auth'], summary: 'Logout — revoga token atual',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/refresh': {
      post: {
        tags: ['Auth'], summary: 'Rotação de refresh token',
        responses: { 200: { description: 'Novo access token emitido' }, 401: { description: 'Refresh token inválido' } },
      },
    },
    '/me': {
      get: {
        tags: ['Auth'], summary: 'Dados do usuário autenticado',
        responses: { 200: { description: 'Perfil do usuário' }, 401: { description: 'Não autenticado' } },
      },
    },

    // ── Contas ────────────────────────────────────────────────────────────
    '/contas': {
      get: {
        tags: ['Contas'], summary: 'Árvore de contas (estrutura apenas — sem lançamentos)',
        responses: {
          200: { description: 'Árvore hierárquica de contas', content: { 'application/json': { schema: {
            type: 'object', properties: {
              ok:     { type: 'boolean' },
              contas: { type: 'array', items: { $ref: '#/components/schemas/Conta' } },
            },
          }}}},
          401: { description: 'Não autenticado' },
        },
      },
      post: {
        tags: ['Contas'], summary: 'Cria nova conta',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['nome'],
            properties: {
              parent_codigo: { type: 'string', example: '1' },
              nome:          { type: 'string', example: 'ALUGUEL' },
              natureza:      { type: 'string', enum: ['entrada', 'saida'] },
            },
          }}},
        },
        responses: {
          200: { description: 'Conta criada', content: { 'application/json': { schema: {
            type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'integer' }, codigo: { type: 'string' } },
          }}}},
          400: { description: 'Dados inválidos' }, 404: { description: 'Conta pai não encontrada' },
        },
      },
    },
    '/contas/hash': {
      get: {
        tags: ['Contas'], summary: 'Hash de estrutura para cache invalidation',
        responses: { 200: { description: 'Hash atual das contas' } },
      },
    },
    '/contas/{codigo}': {
      put: {
        tags: ['Contas'], summary: 'Renomeia conta ou altera orçamento',
        parameters: [{ name: 'codigo', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: {
            type: 'object', properties: {
              nome:      { type: 'string' },
              orcamento: { type: 'number' },
            },
          }}},
        },
        responses: { 200: { description: 'OK' }, 404: { description: 'Conta não encontrada' } },
      },
      delete: {
        tags: ['Contas'], summary: 'Soft-delete da conta (e seus lançamentos)',
        parameters: [{ name: 'codigo', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 409: { description: 'Conta possui subcontas ativas' } },
      },
    },

    // ── Lançamentos ───────────────────────────────────────────────────────
    '/lancamentos': {
      get: {
        tags: ['Lançamentos'],
        summary: 'Lista lançamentos. ?ano=XXXX retorna todos do ano; ?conta_id=X retorna paginado por conta.',
        parameters: [
          { name: 'ano',      in: 'query', schema: { type: 'integer', example: 2026 } },
          { name: 'conta_id', in: 'query', schema: { type: 'integer' } },
          { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit',    in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          { name: 'dtI',      in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dtF',      in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'busca',    in: 'query', schema: { type: 'string' } },
          { name: 'ordem',    in: 'query', schema: { type: 'string', enum: ['data-desc','data-asc','valor-desc','valor-asc'] } },
        ],
        responses: {
          200: { description: 'Lista de lançamentos', content: { 'application/json': { schema: {
            type: 'object', properties: {
              ok:          { type: 'boolean' },
              lancamentos: { type: 'array', items: { $ref: '#/components/schemas/Lancamento' } },
              total:       { type: 'integer' },
              page:        { type: 'integer' },
              pages:       { type: 'integer' },
            },
          }}}},
        },
      },
      post: {
        tags: ['Lançamentos'], summary: 'Cria lançamento',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['conta_codigo', 'data', 'tipo', 'valor'],
            properties: {
              conta_codigo:   { type: 'string', example: '1.2' },
              data:           { type: 'string', format: 'date' },
              tipo:           { type: 'string', enum: ['credito', 'debito'] },
              valor:          { type: 'number', minimum: 0.01 },
              descricao:      { type: 'string' },
              fornecedor_id:  { type: 'integer', nullable: true },
            },
          }}},
        },
        responses: { 200: { description: 'Lançamento criado' }, 400: { description: 'Dados inválidos' } },
      },
    },
    '/lancamentos/{id}': {
      put: {
        tags: ['Lançamentos'], summary: 'Edita lançamento',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['data', 'tipo', 'valor'],
            properties: {
              data:  { type: 'string', format: 'date' },
              tipo:  { type: 'string', enum: ['credito', 'debito'] },
              valor: { type: 'number', minimum: 0.01 },
              descricao:     { type: 'string', nullable: true },
              fornecedor_id: { type: 'integer', nullable: true },
            },
          }}},
        },
        responses: { 200: { description: 'OK' }, 404: { description: 'Não encontrado' } },
      },
      delete: {
        tags: ['Lançamentos'], summary: 'Soft-delete de lançamento',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Não encontrado' } },
      },
    },

    // ── Fornecedores ──────────────────────────────────────────────────────
    '/fornecedores': {
      get: {
        tags: ['Fornecedores'], summary: 'Lista fornecedores da empresa',
        responses: { 200: { description: 'Lista', content: { 'application/json': { schema: {
          type: 'object', properties: {
            ok: { type: 'boolean' },
            fornecedores: { type: 'array', items: { $ref: '#/components/schemas/Fornecedor' } },
          },
        }}}}},
      },
      post: {
        tags: ['Fornecedores'], summary: 'Cria fornecedor',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['tipoPessoa', 'razaoSocial'],
            properties: {
              tipoPessoa:   { type: 'string', enum: ['fisica', 'juridica'] },
              razaoSocial:  { type: 'string' },
              nomeFantasia: { type: 'string' },
              cnpj:         { type: 'string' },
              cpf:          { type: 'string' },
            },
          }}},
        },
        responses: { 200: { description: 'Fornecedor criado' }, 400: { description: 'Dados inválidos' } },
      },
    },
    '/fornecedores/{id}': {
      put: {
        tags: ['Fornecedores'], summary: 'Atualiza fornecedor',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Não encontrado' } },
      },
      delete: {
        tags: ['Fornecedores'], summary: 'Desativa fornecedor (soft-delete)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Não encontrado' } },
      },
    },

    // ── Recibos ───────────────────────────────────────────────────────────
    '/recibos': {
      get: {
        tags: ['Recibos'], summary: 'Lista recibos do ano',
        parameters: [
          { name: 'ano',   in: 'query', schema: { type: 'integer' } },
          { name: 'page',  in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'busca', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista de recibos' } },
      },
      post: {
        tags: ['Recibos'], summary: 'Emite recibo',
        responses: { 200: { description: 'Recibo criado' } },
      },
    },
    '/recibos/{id}/assinar': {
      put: {
        tags: ['Recibos'], summary: 'Confirma assinatura do recibo',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Não encontrado' } },
      },
    },
    '/recibos/{id}': {
      delete: {
        tags: ['Recibos'], summary: 'Remove recibo',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Não encontrado' } },
      },
    },

    // ── Health ────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Sistema'], summary: 'Health check', security: [],
        responses: { 200: { description: 'Servidor operacional' } },
      },
    },
  },
};
