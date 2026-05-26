# Plano de Melhoria — Plano de Contas

Este documento reúne a lista priorizada de melhorias, recomendações e ações propostas pelo time de engenharia (análise inicial). Serve como checklist para implementar mudanças incrementais no repositório.

> Observação: não aplique nada diretamente sem criar backup dos dados (localStorage) e versionar as alterações. Alguns itens exigem migração de dados cuidadosa.

## Sumário rápido

- Branding / strings centrais
- Configurações UI (constantes)
- Autenticação backend
- Versionamento do schema e migração
- Sanitização / segurança (XSS)
- Datas e timezone
- Testes automatizados
- Lint / CI
- Acessibilidade
- Performance para listas grandes
- Outros (undo/redo, export/import, docs)

## Lista priorizada de melhorias (detalhada)

1. Centralizar branding / texto fixo em arquivo de configuração
   - O que: mover strings (e.g., "Plano de Contas", "Patrimônio da Mata Brasil") para `config/branding.js` ou `branding.json`.
   - Por que: evita inconsistência e facilita customização/white-label.
   - Arquivos-alvo: `index.html`, `report.js`, `login.js`, `styles.css`, `README.md`, scripts.
   - Risco: baixo — alteração de strings.
   - Esforço: S (~30–90 min)

2. Externalizar constantes de UI / comportamento
   - O que: mover números/configs (ex: `BREAKDOWN_MAX_ITEMS = 8`, formatos de data) para `config/ui.js`.
   - Benefício: comportamento configurável sem tocar lógica.
   - Esforço: S

3. Migrar autenticação/gerenciamento de usuários para backend
   - O que: projetar API de auth, tokens, permissões; adaptar `auth.js` e `login.js`.
   - Por que: segurança, logs, controle central.
   - Risco: médio; Esforço: L

4. Versionamento do schema + ferramenta de migração/backup
   - O que: adicionar `meta.version` no JSON salvo e migradores para formatos antigos.
   - Prioridade: alta (evita perda de dados)

5. Sanitização de entrada / prevenção de XSS
   - O que: revisar todo `innerHTML` e usar `escapeHtml()` ou `textContent`.
   - Por que: segurança crucial.
   - Esforço: M

6. Padronizar tratamento de datas / timezone
   - O que: utilitário central de parse/format; evitar concatenações ad-hoc (`'T12:00:00'`).
   - Benefício: evita inconsistências e erros de ordenação/filtragem.

7. Testes unitários para domínio e repositório
   - O que: adicionar `jest`/`vitest` e testes para `PlanoContasRepository`, saldo, orçamentos.
   - Benefício: maior confiança nas mudanças.

8. Lint / CI / Prettier
   - O que: `eslint`, `prettier`, `package.json` com scripts e pipeline GitHub Actions.

9. Acessibilidade (a11y)
   - O que: auditar ARIA, roles, gerenciamento de foco e contraste.

10. Performance em listas grandes (virtualização/paginação)
    - O que: implementar carregamento incremental ou virtual scroll para `detailLancamentos`.

11. Reavaliar Undo/Redo (opcional)
    - O que: implementar histórico de ações (command pattern) se workflow justificar.

12. Export/Import robusto e backups automáticos

13. Limpeza de código/debt técnico (remover dead code, duplicações)

14. Internationalização (i18n) — extrair strings para arquivos de locale

15. Monitoramento / telemetria (Sentry, logs JS)

16. Documentação operativa e checklist de deploy
    - Criar `DOCS/DEPLOY.md` com instruções de backup e migração.

17. Hardening (CSP)

18. Planejamento de migração para TypeScript (opcional, de médio-longo prazo)


## Prioridade mínima imediata (A executar primeiro)
Esses são os passos que reduzem riscos mais críticos rapidamente.

- [ ] 1) Criar `config/branding.js` e `config/ui.js` (centralizar strings e constantes)
- [ ] 2) Implementar backup automático + versionamento do schema (meta.version)
- [ ] 3) Revisar e corrigir XSS (sanitização dos `innerHTML` existentes)
- [ ] 4) Padronizar parsing/format de datas (utilitário `date-utils.js`)
- [ ] 5) Adicionar testes unitários iniciais para o repositório (saldo/orçamento)

> Observação: para qualquer alteração que toque persistência, criar primeiro um backup exportável e um script de migração reversível.

## Como usar este documento

- Vá marcando os itens da seção "Prioridade mínima imediata" à medida que forem concluídos.
- Para cada item maior (ex.: autenticação backend), crie um epic/ticket com subtarefas e previsão de esforço.

## Próximos passos que proponho

1. Se desejar, eu crio os arquivos `config/branding.js` e `config/ui.js` e atualizo a aplicação para consumi-los (mudança rápida, S).
2. Em paralelo, crio um script `backup_localstorage.js` e uma tarefa no repo para gerar backup antes de mudanças de schema.

## Migração ENTRADAS/SAIDAS — uso rápido

- A modal de migração está disponível no menu do usuário (apenas para administradores).
- Ao abrir, a modal lista cada conta raiz com uma sugestão automática (ENTRADAS/SAÍDAS/MANTER).
- Você pode ajustar manualmente cada mapeamento usando o dropdown ao lado de cada conta.
- Crie um backup usando o botão "Criar backup" antes de aplicar.
- É possível restaurar o último backup ou escolher um backup da lista e restaurá-lo.
- Após aplicar a migração, a aplicação tenta atualizar a árvore automaticamente — caso algo pareça errado, restaure o backup e reavalie as escolhas.

Recomendação: testar a migração em uma cópia dos dados (abrir `migrate/test_migrate.html` no navegador) antes de aplicar em produção.

## Instruções detalhadas — backup e restauração

Essas instruções ajudam um administrador a criar backups, verificar e restaurar caso seja necessário reverter uma migração.

1) Criar um backup (UI)
   - Abra o app como administrador → menu do usuário → Migrar ENTRADAS/SAIDAS → botão "Criar backup".
   - O sistema cria uma chave no localStorage com o padrão: `plano_gerencial_contas_v2_backup_<timestamp>`.
   - Uma notificação (toast) mostra a chave criada.

2) Listar backups (Console)
   - No Console do navegador (DevTools) execute:
     ```javascript
     window.migrateEntradasSaidas.listBackups();
     ```
   - Retorna um array com as chaves de backups, ordenadas do mais recente para o mais antigo.

3) Restaurar um backup específico (UI)
   - Abra a modal de migração (menu do usuário → Migrar ENTRADAS/SAIDAS).
   - No seletor de backups escolha a chave desejada e clique em "Restaurar backup selecionado".
   - Confirme a operação quando solicitado. A restauração sobrescreve a chave principal (`plano_gerencial_contas_v2`).
   - Após restaurar, a modal tentará atualizar a pré-visualização automaticamente.

4) Restaurar o último backup (Console)
   - Para automatizar/consultar via Console:
     ```javascript
     const backups = window.migrateEntradasSaidas.listBackups();
     if (backups.length) window.migrateEntradasSaidas.restoreBackup(backups[0]);
     window.dispatchEvent(new Event('repo:ready'));
     ```
   - Isso restaura a cópia mais recente e emite `repo:ready` para que a UI recarregue os dados.

5) Verificação pós-restauração
   - Após restaurar, valide visualmente a árvore no app e verifique relatórios importantes (saldo total, principais grupos).
   - Se necessário, repita o processo com outro backup.

6) Boas práticas
   - Sempre criar um backup manual antes de aplicar a migração (a opção "Aplicar migração" também cria backup automaticamente quando usada pela UI).
   - Não execute migrações diretamente em ambientes de produção sem testar primeiro em cópia local.
   - Guarde externamente (exporte) backups importantes se for fazer várias operações consecutivas.

## Restauração emergencial (sem UI)

Se a interface estiver indisponível, você pode restaurar um backup manualmente no Console do navegador (ou via script que manipule localStorage):

```javascript
// exemplo simples no Console (executar no contexto da página onde o app roda)
const backups = window.migrateEntradasSaidas.listBackups();
if (backups.length) {
  const last = backups[0];
  const raw = localStorage.getItem(last);
  if (raw) {
    localStorage.setItem('plano_gerencial_contas_v2', raw);
    localStorage.setItem('plano_gerencial_contas_v2_last_restore', last);
    window.dispatchEvent(new Event('repo:ready'));
    console.log('Backup restaurado:', last);
  } else console.warn('Backup não encontrado:', last);
} else console.warn('Nenhum backup encontrado');
```

---

Com esse guia os administradores terão um procedimento claro para criar backups, aplicar e reverter migrações. Mantenha uma política de backups antes de qualquer operação de alteração de schema.

---

## Aplicar migração automaticamente (script)

Existe um script utilitário em `migrate/apply_suggested_migration.js` que automatiza o fluxo de migração (gerar sugestão, criar backup e aplicar).

Como usar:
1. Abra a aplicação e entre como administrador.
2. Abra DevTools → Console.
3. Copie/cole o conteúdo do arquivo `migrate/apply_suggested_migration.js` no Console e pressione Enter.
4. Confirme a caixa de diálogo para aplicar a migração.

O script cria um backup automaticamente antes de aplicar e emite `repo:ready` ao final, para que a UI recarregue o estado.

Arquivo gerado automaticamente por auditoria inicial — marque as tarefas e vamos implementando por prioridade.
