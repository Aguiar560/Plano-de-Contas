# Plano de Contas — Patrimônio da Mata Brasil

Sistema financeiro completo para gestão do plano de contas, lançamentos, fornecedores e recibos de autônomo da associação **Patrimônio da Mata Brasil**.

---

## Funcionalidades

- **Plano de Contas** — árvore hierárquica com drag-and-drop, orçamento anual por conta e barra de progresso
- **Lançamentos** — débitos e créditos por conta com filtros, paginação e exportação CSV
- **Fornecedores** — cadastro de PJ e PF com busca por CNPJ/CPF via ViaCEP
- **Recibo de Autônomo** — geração de RPA com cálculo automático de INSS e IRRF (tabela progressiva 2026)
- **Relatórios** — DRE, fluxo de caixa e comparativo orçado vs realizado
- **Dashboard** — resumo financeiro do período com indicadores
- **Importação OFX** — importação de extratos bancários
- **Multiusuário** — perfis admin, gerente, operador e visualizador com permissões granulares
- **Auditoria** — log completo de todas as ações por usuário
- **Sincronização** — polling automático a cada 30s para detectar alterações de outros usuários

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5 + CSS3 + Vanilla JS (SPA) |
| Backend | Node.js + Express 4 |
| Banco de dados | MySQL |
| Autenticação | JWT (cookie httpOnly) + bcryptjs |
| Segurança | Helmet, CORS, rate limiting, CSRF, Joi |
| Testes | Jest + Supertest |

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- MySQL 5.7 ou superior
- Git

---

## Instalação

### 1. Clonar o repositório

```bash
git clone https://github.com/Aguiar560/Plano-de-Contas.git
cd Plano-de-Contas
```

### 2. Instalar dependências do servidor

```bash
cd server
npm install
```

### 3. Criar o banco de dados MySQL

```sql
CREATE DATABASE plano_contas CHARACTER SET utf8 COLLATE utf8_unicode_ci;
```

Execute o schema inicial:

```bash
npm run run-schema
```

### 4. Configurar variáveis de ambiente

Crie o arquivo `server/.env` baseado no exemplo abaixo:

```env
# Banco de dados
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=sua_senha
DB_NAME=plano_contas

# JWT — use uma string aleatória de pelo menos 32 caracteres
JWT_SECRET=troque-por-uma-chave-segura-com-32-chars-minimo
JWT_EXP=8h

# Servidor
PORT=3000
NODE_ENV=development

# Produção: defina a origem permitida para CORS e CSRF
# API_ORIGIN=https://seudominio.com.br
```

### 5. Iniciar o servidor

**Windows (forma rápida):** execute `start_all.bat` na raiz do projeto — abre o servidor e o navegador automaticamente.

**Ou manualmente:**

```bash
cd server
node server.js
```

Acesse: [http://localhost:3000](http://localhost:3000)

**Login padrão:** `admin` / `admin` — **altere a senha no primeiro acesso.**

---

## Estrutura do Projeto

```
Plano-de-Contas/
├── index.html              # SPA principal
├── styles.css              # Estilos globais
├── logo-pmb.png            # Logo da associação
├── start_all.bat           # Atalho de inicialização (Windows)
│
├── client/                 # JavaScript do frontend
│   ├── app.js              # Modelo de dados e utilitários
│   ├── tree.js             # Árvore de contas e painel de lançamentos
│   ├── auth.js             # Sessão e permissões do usuário logado
│   ├── login.js            # Tela de login
│   ├── nav.js              # Roteamento de views e branding
│   ├── dashboard.js        # Dashboard financeiro
│   ├── fornecedores-page.js
│   ├── recibo-autonomo.js  # Geração do RPA (popup de impressão)
│   ├── recibo-events.js    # Interações dentro do popup do RPA
│   ├── recibos-page.js     # Listagem e reimpressão de recibos
│   ├── report.js           # Relatórios
│   ├── ofx-import.js       # Importação de extrato OFX
│   └── search.js           # Busca global
│
└── server/                 # Backend Node.js/Express
    ├── server.js           # Entry point — middleware, segurança, startup
    ├── db.js               # Pool MySQL (mysql2/promise)
    ├── users-db.js         # Gerenciamento de usuários (JSON + MySQL)
    ├── logger.js           # Logger estruturado
    ├── routes/
    │   ├── auth.js         # POST /login, /logout, /refresh
    │   ├── users.js        # CRUD de usuários e GET /audit
    │   ├── contas.js       # CRUD de contas + GET /contas/hash (ETag/polling)
    │   ├── lancamentos.js  # CRUD de lançamentos
    │   ├── fornecedores.js # CRUD de fornecedores
    │   └── recibos.js      # CRUD de recibos de autônomo
    └── __tests__/          # Testes Jest + Supertest
```

---

## Scripts disponíveis

```bash
# Dentro de server/

npm start              # Inicia o servidor
npm test               # Executa todos os testes
npm run test:coverage  # Testes com relatório de cobertura
npm run run-schema     # Executa o schema SQL inicial
npm run migrate        # Aplica migrações pendentes
npm run migrate:status # Exibe status das migrações
```

---

## Segurança

- Senhas armazenadas com **bcryptjs** (hash + salt)
- Tokens JWT em **cookies httpOnly** (não acessíveis via JavaScript)
- **Helmet** com CSP configurado — bloqueio de scripts inline
- **Rate limiting** por rota: auth (10/min), escrita (60/min), leitura (200/min)
- **CSRF**: validação de header `Origin` em produção
- **Joi** para validação de todos os inputs da API
- Suporte a **rotação de JWT** via `JWT_SECRET_PREV`
- Logs de auditoria de todas as operações com IP e user-agent

---

## Variáveis de ambiente (referência completa)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DB_HOST` | `127.0.0.1` | Host do MySQL |
| `DB_PORT` | `3306` | Porta do MySQL |
| `DB_USER` | `root` | Usuário do MySQL |
| `DB_PASS` | _(vazio)_ | Senha do MySQL |
| `DB_NAME` | `plano_contas` | Nome do banco |
| `JWT_SECRET` | ⚠ inseguro | Chave JWT — **obrigatório definir em produção** |
| `JWT_SECRET_PREV` | _(vazio)_ | Chave JWT anterior (rotação) |
| `JWT_EXP` | `8h` | Expiração do token |
| `PORT` | `3000` | Porta HTTP |
| `NODE_ENV` | `development` | Ambiente (`production` ativa HSTS e CSRF) |
| `API_ORIGIN` | _(vazio)_ | Origem permitida para CORS/CSRF em produção |
| `COOKIE_SECURE` | `false` | Forçar cookie Secure fora de produção |

---

## Licença

Uso interno — Associação Patrimônio da Mata Brasil.
