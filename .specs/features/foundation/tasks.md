# M0 — Fundação: Tasks

**Design:** `.specs/features/foundation/design.md`
**Spec:** `.specs/features/foundation/spec.md`
**Testing:** `.specs/codebase/TESTING.md`
**Status:** Draft

23 tasks. Uma entrega por task, com teste co-locado.

---

## Execution Plan

### Fase 1 — Chão do repositório (sequencial)

```
T1 → T2
```

### Fase 2 — Pacotes e persistência

A cadeia de banco é sequencial; os pacotes puros correm em paralelo com ela.

```
T2 ──→ T3 ──→ T4 ──→ T5 ──→ T6        (cadeia de banco, sequencial)

T1 ──┬──→ T7  [P]
     ├──→ T8  [P]
     ├──→ T9  [P]
     ├──→ T10 [P]
     └──→ T15 [P]
```

### Fase 3 — Painel (paralela à Fase 4)

```
T1 ──┐
     ├──→ T20 ──┬──→ T21 [P]
T9 ──┘          └──→ T22 [P]
```

### Fase 4 — API (sequencial, exceto T19)

```
T3 ──┐
     ├──→ T11 ──→ T12 ──→ T13 ──→ T14 ──→ T16 ──→ T17 ──→ T18
T10 ─┘             │                ↑        ↑
T4 ────────────────┤                │        │
T7 ────────────────┘                │        │
T8 ─────────────────────────────────┤        │
T9 ─────────────────────────────────┘        │
T15 ─────────────────────────────────────────┘
T4 ──────────────────────────────────→ T16
T12 ─┬──→ T19 [P]
T8 ──┘
```

### Fase 5 — Fechamento

```
T2, T17, T21, T22 ──→ T23
```

---

## Task Breakdown

### T1: Base do monorepo pnpm

**What:** workspace pnpm com `apps/{api,web}` e `packages/{db,core,contracts}`, tsconfig base, ESLint + Prettier, config raiz do Vitest e os scripts de verificação.
**Where:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.workspace.ts`
**Depends on:** —
**Reuses:** —
**Requirement:** ENV-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `pnpm install` resolve os cinco workspaces
- [x] Scripts `lint`, `typecheck`, `test:unit`, `test:int`, `test:e2e`, `test`, `check`, `build` existem na raiz
- [x] Regra de lint proíbe `apps/**` importar de `packages/*/src/**` por caminho relativo, e proíbe `packages/{core,db}` importarem `@nestjs/*`
- [x] `pnpm check` retorna zero em repositório vazio e diferente de zero se qualquer etapa falhar
- [x] Gate check passa: `pnpm build`

**Tests:** none · **Gate:** build
**Verify:** `pnpm check; echo $?` → `0`. Introduzir erro de tipo proposital e confirmar saída diferente de zero.
**Commit:** `chore(repo): estrutura do monorepo e scripts de verificação`

---

### T2: Docker Compose com Postgres, Redis e papéis de banco

**What:** `compose.yml` com `postgres` e `redis`, healthcheck no Postgres, script de init criando `orquestra_owner` (DDL) e `orquestra_app` (DML, `NOBYPASSRLS`), e `.env.example` completo.
**Where:** `docker/compose.yml`, `docker/postgres/init.sql`, `.env.example`
**Depends on:** T1
**Reuses:** —
**Requirement:** ENV-01 (parcial)

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `docker compose up -d postgres redis` deixa o Postgres com healthcheck saudável
- [x] `orquestra_app` não tem privilégio de DDL nem `BYPASSRLS`; `orquestra_owner` tem DDL
- [x] `.env.example` lista todas as variáveis, sem valor real, incluindo `DATABASE_URL` e `DATABASE_MIGRATION_URL` apontando para papéis distintos
- [x] `.env` está no `.gitignore`
- [x] Gate check passa: `pnpm build`

**Tests:** none · **Gate:** build
**Verify:** conectar como `orquestra_app` e confirmar que `create table t(x int)` é recusado.
**Commit:** `chore(infra): compose com postgres, redis e papéis de banco separados`

---

### T3: Pacote `db` — schema de identidade, migrações e migrator

**What:** schema Drizzle de `tenants`, `users`, `memberships`, `sessions`; config do drizzle-kit; `runMigrations()` com `pg_advisory_lock` e uma transação por migração.
**Where:** `packages/db/src/schema/identity.ts`, `packages/db/src/migrate.ts`, `packages/db/drizzle.config.ts`, `packages/db/migrations/*.sql`
**Depends on:** T2
**Reuses:** UUID v7 e tipos de `packages/core` quando T7 existir; até lá, tipos locais
**Requirement:** DATA-01, DATA-02, DATA-03

**Tools:** MCP: `context7` (API do drizzle-kit) · Skill: NENHUMA

**Done when:**
- [x] As quatro tabelas nascem com PK UUID, `created_at`, e `users.email` como `citext` único
- [x] Migração aplicada duas vezes seguidas não reaplica (registro em `drizzle.__drizzle_migrations`)
- [x] Migração que falha no meio deixa o banco no estado anterior a ela
- [x] Duas execuções concorrentes de `runMigrations()` serializam pelo advisory lock, aplicando cada migração uma vez
- [x] Gate check passa: `pnpm check`
- [x] Test count: 5 testes de integração passam (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Verify:** contra banco vazio do Testcontainers, aplicar migrações e conferir as quatro tabelas em `information_schema`.
**Commit:** `feat(db): schema de identidade e migrator versionado`

---

### T4: Contexto de tenant — `withTenant` e `withoutTenant`

**What:** pool único, `withTenant`/`withoutTenant` abrindo transação com `select set_config('app.tenant_id', $1, true)`, `getTenantId()` sobre `AsyncLocalStorage`, e o pool exportado apenas para dentro do pacote.
**Where:** `packages/db/src/tenant-context.ts`, `packages/db/src/pool.ts`, `packages/db/src/index.ts`
**Depends on:** T3
**Reuses:** pool e client Drizzle de T3
**Requirement:** RLS-05 (e base de RLS-02, RLS-04)

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `withTenant` estabelece o setting no escopo da transação e o commit encerra o contexto
- [x] `getTenantId()` lança quando chamado fora de `withTenant`
- [x] Com pool de `max: 1`, operações alternando tenant A e B não vazam contexto entre transações
- [x] O pool não é exportado no `index.ts` do pacote; o único acesso público é `withTenant`/`withoutTenant`
- [x] Gate check passa: `pnpm check`
- [x] Test count: 5 testes de integração passam (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Verify:** teste de pool `max: 1` alternando tenants; sem `SET LOCAL` o teste falha.
**Commit:** `feat(db): contexto de tenant com escopo transacional`

---

### T5: `service_records` com RLS

**What:** tabela `service_records` no formato final (`tenant_id`, `service_instance_id` sem FK, `collection`, `key`, `data jsonb`), com `enable`/`force row level security`, policy `tenant_isolation` (`using` + `with check`) e grants para `orquestra_app`.
**Where:** `packages/db/src/schema/service-data.ts`, `packages/db/migrations/*.sql`
**Depends on:** T4
**Reuses:** padrão de migração de T3, `withTenant` de T4
**Requirement:** RLS-02, RLS-03, RLS-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Sob contexto de A, `select *` sem `where` devolve só linhas de A
- [x] Insert com `tenant_id` de B sob contexto de A é recusado pelo `with check`
- [x] Update que tentaria mover linha para outro tenant é recusado
- [x] Sem contexto estabelecido, a tabela devolve zero linhas em vez de erro
- [x] Gate check passa: `pnpm check`
- [x] Test count: 6 testes de integração passam (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Verify:** semear dois tenants e rodar a suíte de isolamento.
**Commit:** `feat(db): service_records sob row-level security`

---

### T6: Teste de cobertura de RLS por introspecção

**What:** teste que consulta `pg_class` e `pg_policies` e falha nomeando qualquer tabela com coluna `tenant_id` sem `relrowsecurity`, sem `relforcerowsecurity` ou sem policy.
**Where:** `packages/db/test/rls-coverage.int.test.ts`
**Depends on:** T5
**Reuses:** harness de Testcontainers de T3
**Requirement:** RLS-01, RLS-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] O teste passa com o esquema atual
- [x] Criar tabela com `tenant_id` sem policy faz o teste falhar citando o nome da tabela
- [x] A mensagem de falha lista todas as tabelas descobertas, não apenas a primeira
- [x] Gate check passa: `pnpm check`
- [x] Test count: 1 teste de integração passa (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Verify:** acrescentar tabela de teste sem policy numa migração temporária e confirmar a falha nominal.
**Commit:** `test(db): gate de cobertura de RLS por introspecção`

---

### T7: Pacote `core` — identificadores, papéis e erros de domínio [P]

**What:** `newId()` gerando UUID v7, o enum de papéis (`owner`, `admin`, `operator`) com ordem de precedência, e as classes de erro de domínio.
**Where:** `packages/core/src/id.ts`, `packages/core/src/roles.ts`, `packages/core/src/errors.ts`
**Depends on:** T1
**Reuses:** —
**Requirement:** ROLE-01 (modelo), edge case de identificador não sequencial

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `newId()` produz UUID v7 válido e monotônico dentro do mesmo milissegundo
- [x] `hasAtLeast(role, required)` respeita `owner > admin > operator`
- [x] Erros de domínio carregam código estável, sem texto de UI
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 8 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(core): identificadores, papéis e erros de domínio`

---

### T8: Pacote `core` — hash de senha Argon2id [P]

**What:** `hashPassword` e `verifyPassword` com Argon2id e parâmetros injetáveis, mais `assertPasswordPolicy` com o comprimento mínimo.
**Where:** `packages/core/src/password.ts`
**Depends on:** T1
**Reuses:** erros de domínio de T7 quando existirem
**Requirement:** AUTH-03

**Tools:** MCP: `context7` (API do `argon2`) · Skill: NENHUMA

**Done when:**
- [x] Dois hashes da mesma senha diferem entre si (sal por usuário) e ambos verificam
- [x] `verifyPassword` devolve falso para senha errada e não lança para hash malformado
- [x] A senha em texto claro não aparece no valor retornado nem na mensagem de erro
- [x] Parâmetros de custo vêm de argumento, permitindo custo baixo em teste
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 5 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(core): hash de senha com Argon2id`

---

### T9: Pacote `contracts` — schemas de autenticação [P]

**What:** schemas Zod e tipos derivados de `LoginRequest`, `LoginResponse`, `MeResponse` e do envelope de erro da API.
**Where:** `packages/contracts/src/auth.ts`, `packages/contracts/src/error.ts`
**Depends on:** T1
**Reuses:** —
**Requirement:** base de AUTH-01, SHELL-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `LoginRequest` recusa e-mail inválido e senha vazia
- [x] `MeResponse` expõe usuário, tenant ativo e papel — e nenhum campo de credencial
- [x] O envelope de erro tem código estável e mensagem em português
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 6 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(contracts): schemas de autenticação`

---

### T10: Carregador de configuração [P]

**What:** `loadConfig(env)` com schema Zod que falha listando **todas** as variáveis faltantes.
**Where:** `apps/api/src/config/load-config.ts`
**Depends on:** T1
**Reuses:** —
**Requirement:** ENV-03

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Ambiente completo produz config tipada
- [x] Três variáveis ausentes geram um erro que nomeia as três
- [x] Valor inválido (porta não numérica, URL malformada) é recusado
- [x] A mensagem de erro não ecoa valor de variável, apenas o nome
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 5 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(api): validação de ambiente na inicialização`

---

### T11: Bootstrap da API e endpoint de saúde

**What:** aplicação NestJS com bifurcação por `PROCESS_ROLE`, boot na ordem `loadConfig` → `runMigrations` → escuta HTTP, retry com backoff no Postgres, e `GET /health` distinguindo liveness de readiness.
**Where:** `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/health/`
**Depends on:** T3, T10
**Reuses:** `runMigrations` de T3, `loadConfig` de T10
**Requirement:** ENV-02, ENV-01 (parcial)

**Tools:** MCP: `context7` (bootstrap NestJS) · Skill: NENHUMA

**Done when:**
- [x] `/health` só responde pronto depois das migrações aplicadas
- [x] Variável faltante encerra o processo com código diferente de zero, sem abrir a porta
- [x] Postgres indisponível gera retry com backoff e, esgotado o limite, encerra com código diferente de zero
- [x] `PROCESS_ROLE=worker` sobe sem registrar rotas HTTP
- [x] Gate check passa: `pnpm check`
- [x] Test count: 4 testes e2e passam (sem exclusão silenciosa)

**Tests:** e2e · **Gate:** full
**Commit:** `feat(api): bootstrap com migrações e endpoint de saúde`

---

### T12: Repositórios de tenant, usuário e membership

**What:** consultas de identidade sobre `withoutTenant` — buscar usuário por e-mail normalizado, criar tenant/usuário/membership, resolver o membership mais antigo de um usuário.
**Where:** `apps/api/src/identity/identity.repository.ts`
**Depends on:** T4, T7, T11
**Reuses:** `withoutTenant` de T4, `newId` e papéis de T7
**Requirement:** base de TNT-01, TNT-02, AUTH-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Busca por e-mail é insensível a caixa e a espaço nas bordas
- [x] Nome de tenant duplicado viola a unicidade e o erro é traduzido para erro de domínio
- [x] `findActiveMembership` devolve o vínculo mais antigo de forma determinística
- [x] Gate check passa: `pnpm check`
- [x] Test count: 6 testes de integração passam (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Commit:** `feat(api): repositórios de identidade`

---

### T13: Armazenamento de sessão

**What:** criar, resolver e revogar sessão — token aleatório de 256 bits devolvido uma única vez, SHA-256 persistido, `expires_at` e `last_used_at`.
**Where:** `apps/api/src/auth/session.repository.ts`
**Depends on:** T12
**Reuses:** padrão de repositório de T12
**Requirement:** AUTH-05, AUTH-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] A coluna persistida é o hash; o token cru não aparece em nenhuma coluna
- [x] Sessão expirada não resolve, mesmo com token correto
- [x] `revoke` remove a linha e a resolução seguinte falha
- [x] Token inexistente ou malformado resolve como ausente, sem lançar
- [x] Gate check passa: `pnpm check`
- [x] Test count: 6 testes de integração passam (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Commit:** `feat(api): sessões com estado no Postgres`

---

### T14: Serviço de autenticação

**What:** `login`, `logout` e `me` — normalização de e-mail, verificação de hash, resposta genérica e tempo equalizado quando o e-mail não existe.
**Where:** `apps/api/src/auth/auth.service.ts`
**Depends on:** T8, T9, T13
**Reuses:** `verifyPassword` de T8, contratos de T9, sessões de T13
**Requirement:** AUTH-01, AUTH-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Credencial válida cria sessão e devolve o token cru uma única vez
- [x] E-mail inexistente e senha errada produzem o mesmo erro, com o mesmo código
- [x] E-mail inexistente ainda executa uma verificação contra hash descartável
- [x] `logout` invalida a sessão no servidor
- [x] Gate check passa: `pnpm check`
- [x] Test count: 7 testes de integração passam (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Commit:** `feat(api): serviço de autenticação`

---

### T15: Limitador de tentativas de autenticação [P]

**What:** contador em memória com janela deslizante, atrás de uma interface trocável: `check`, `registerFailure`, `reset`.
**Where:** `apps/api/src/auth/throttle.ts`
**Depends on:** T1
**Reuses:** —
**Requirement:** RATE-01, RATE-02, RATE-03

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Tentativas acima do limite dentro da janela passam a ser recusadas
- [x] A janela expira e libera novas tentativas
- [x] `reset` zera o contador
- [x] A chave é o e-mail normalizado, de modo que variação de caixa não contorna o limite
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 5 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(api): limitador de tentativas de autenticação`

---

### T16: Guard de sessão e resolução do tenant ativo

**What:** `SessionGuard` lendo o cookie, resolvendo sessão → usuário → membership mais antigo, e abrindo o escopo de `AsyncLocalStorage` com o tenant ativo antes do controller.
**Where:** `apps/api/src/auth/session.guard.ts`, `apps/api/src/auth/tenant-scope.interceptor.ts`
**Depends on:** T4, T14
**Reuses:** ALS de T4, serviço de T14
**Requirement:** AUTH-04, AUTH-06, AUTH-07

**Tools:** MCP: `context7` (guards e interceptors do NestJS) · Skill: NENHUMA

**Done when:**
- [x] Rota protegida sem cookie, com cookie adulterado ou com sessão expirada responde 401 idêntico nos três casos
- [x] Usuário sem membership responde 403 com código próprio, distinto do 401
- [x] Dentro do handler, `getTenantId()` devolve o tenant do vínculo mais antigo
- [x] Gate check passa: `pnpm check`
- [x] Test count: 6 testes e2e passam (sem exclusão silenciosa)

**Tests:** e2e · **Gate:** full
**Commit:** `feat(api): guard de sessão e contexto de tenant por requisição`

---

### T17: Rotas de autenticação e cookie de sessão

**What:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, cookie `httpOnly`+`secure`+`sameSite`, throttle acoplado ao login e filtro de exceção que sanitiza a resposta.
**Where:** `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/common/error.filter.ts`
**Depends on:** T15, T16
**Reuses:** guard de T16, throttle de T15, contratos de T9
**Requirement:** AUTH-01, AUTH-02, AUTH-05, RATE-01, RATE-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Login bem-sucedido devolve cookie `httpOnly`, `secure` e `sameSite`, e nenhum token no corpo
- [x] Após `logout`, o cookie capturado passa a receber 401 na mesma rota
- [x] Acima do limite de tentativas, a resposta é idêntica para senha certa e errada
- [x] Nenhuma resposta de erro contém hash, SQL, string de conexão ou token
- [x] Gate check passa: `pnpm check`
- [x] Test count: 9 testes e2e passam (sem exclusão silenciosa)

**Tests:** e2e · **Gate:** full
**Commit:** `feat(api): rotas de autenticação com sessão em cookie`

---

### T18: Guard de papel e regra do último owner

**What:** `RequireRole` como decorator + guard, e a regra que recusa remover ou rebaixar o último `owner` de um tenant.
**Where:** `apps/api/src/auth/role.guard.ts`, `apps/api/src/identity/membership.service.ts`
**Depends on:** T17
**Reuses:** precedência de papéis de T7, guard de T16
**Requirement:** ROLE-01, ROLE-02, ROLE-03

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Papel insuficiente responde 403 de autorização, com código distinto do 401
- [x] Papel suficiente atravessa a rota de exemplo
- [x] Rebaixar ou remover o último `owner` é recusado; com dois owners a operação passa
- [x] Gate check passa: `pnpm check`
- [x] Test count: 5 testes e2e passam (sem exclusão silenciosa)

**Tests:** e2e · **Gate:** full
**Commit:** `feat(api): autorização por papel`

---

### T19: CLI do operador [P]

**What:** `tenant:create` e `user:reset-password`, em transação única, com senha aceita também por stdin.
**Where:** `apps/api/src/cli/main.ts`, `apps/api/src/cli/commands/`
**Depends on:** T8, T12
**Reuses:** repositórios de T12, política de senha de T8
**Requirement:** TNT-01, TNT-02, TNT-03, TNT-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `tenant:create` cria tenant, usuário e membership `owner` numa transação
- [x] E-mail já existente (comparado normalizado) vincula o usuário em vez de duplicar
- [x] Nome de tenant duplicado recusa com mensagem explícita e não escreve nada
- [x] Senha abaixo do mínimo recusa antes de criar qualquer registro
- [x] `user:reset-password` substitui o hash e o login seguinte usa a senha nova
- [x] A senha não aparece em log nem em saída padrão
- [x] Gate check passa: `pnpm check`
- [x] Test count: 7 testes de integração passam (sem exclusão silenciosa)

**Tests:** integration · **Gate:** full
**Commit:** `feat(api): CLI de provisionamento de tenant`

---

### T20: Base do painel — Vite, roteador e cliente HTTP

**What:** app React + Vite com roteador, cliente de API enviando credenciais, e interceptor que trata 401 empurrando para o login.
**Where:** `apps/web/src/main.tsx`, `apps/web/src/router.tsx`, `apps/web/src/api/client.ts`
**Depends on:** T1, T9
**Reuses:** contratos de T9
**Requirement:** SHELL-05

**Tools:** MCP: `context7` (Vite) · Skill: NENHUMA

**Done when:**
- [x] O cliente envia cookie em toda requisição (`credentials: 'include'`)
- [x] Resposta 401 durante o uso leva ao login, sem exibir erro cru
- [x] Erro de rede é distinguido de 401 e não desloga o usuário
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 6 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(web): base do painel com roteador e cliente de API`

---

### T21: Tela de autenticação [P]

**What:** formulário de e-mail e senha, estado de envio, e mensagem de erro genérica.
**Where:** `apps/web/src/routes/login.tsx`
**Depends on:** T20
**Reuses:** cliente de T20, schemas de T9
**Requirement:** SHELL-03

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Credencial válida navega para o shell
- [x] Falha exibe mensagem genérica, sem revelar se o e-mail existe
- [x] O botão fica desabilitado durante o envio, impedindo duplo submit
- [x] O campo de senha não é persistido em nenhum armazenamento do navegador
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 5 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(web): tela de autenticação`

---

### T22: Shell autenticado e rota protegida [P]

**What:** `ProtectedRoute` consultando `GET /auth/me`, layout com nome do tenant ativo e do usuário, e ação de sair.
**Where:** `apps/web/src/routes/app.tsx`, `apps/web/src/components/protected-route.tsx`
**Depends on:** T20
**Reuses:** cliente de T20
**Requirement:** SHELL-01, SHELL-02, SHELL-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Visitante não autenticado em rota protegida é redirecionado ao login
- [x] Autenticado vê o nome do tenant ativo e o do usuário no shell
- [x] Sair encerra a sessão e retorna ao login
- [x] Enquanto `me` carrega, a tela mostra estado de carregamento em vez de piscar o login
- [x] Gate check passa: `pnpm typecheck && pnpm test:unit`
- [x] Test count: 5 testes unitários passam (sem exclusão silenciosa)

**Tests:** unit · **Gate:** quick
**Commit:** `feat(web): shell autenticado com tenant ativo`

---

### T23: Subida ponta a ponta em um comando

**What:** `api` e `web` no Compose, script `pnpm dev`, README de subida, e o percurso completo verificado do clone ao painel.
**Where:** `docker/compose.yml` (alterar), `apps/api/Dockerfile`, `apps/web/Dockerfile`, `README.md`
**Depends on:** T2, T17, T21, T22
**Reuses:** compose de T2
**Requirement:** ENV-01, ENV-04

**Tools:** MCP: `playwright` (percurso no navegador) · Skill: NENHUMA

**Done when:**
- [ ] Em diretório limpo: clonar, copiar `.env.example`, `pnpm dev` e obter resposta de `/health`
- [ ] Provisionar tenant pelo CLI e autenticar no painel, vendo o nome do tenant
- [ ] Volume do banco destruído e recriado reconstrói o esquema com as policies
- [ ] `pnpm check` verde do início ao fim
- [ ] Gate check passa: `pnpm check`
- [ ] Test count: soma das suítes anteriores passa (sem exclusão silenciosa)

**Tests:** e2e · **Gate:** full
**Commit:** `chore(infra): subida completa do ambiente em um comando`

---

## Validação pré-aprovação

### Check 1 — Granularidade

| Task | Escopo | Status |
|---|---|---|
| T1 | Config do workspace | ✅ |
| T2 | Compose + init de banco | ✅ coeso |
| T3 | Schema de identidade + migrator | ✅ coeso (mesmo pacote, uma entrega) |
| T4 | Um módulo | ✅ |
| T5 | Uma tabela + policy | ✅ |
| T6 | Um teste | ✅ |
| T7 | Três primitivas do mesmo pacote | ⚠️ coeso, aceito |
| T8 | Um módulo | ✅ |
| T9 | Dois schemas | ✅ coeso |
| T10 | Uma função | ✅ |
| T11 | Bootstrap + health | ✅ coeso |
| T12 | Um repositório | ✅ |
| T13 | Um repositório | ✅ |
| T14 | Um serviço | ✅ |
| T15 | Um módulo | ✅ |
| T16 | Um guard + escopo | ✅ coeso |
| T17 | Um controller + módulo | ✅ coeso |
| T18 | Um guard + uma regra | ✅ coeso |
| T19 | Dois comandos do mesmo CLI | ✅ coeso |
| T20 | Base do app | ✅ |
| T21 | Uma tela | ✅ |
| T22 | Uma rota + um componente | ✅ coeso |
| T23 | Fechamento de infra | ✅ |

### Check 2 — Diagrama × definição

| Task | `Depends on` | Diagrama | Status |
|---|---|---|---|
| T1 | — | raiz | ✅ |
| T2 | T1 | T1 → T2 | ✅ |
| T3 | T2 | T2 → T3 | ✅ |
| T4 | T3 | T3 → T4 | ✅ |
| T5 | T4 | T4 → T5 | ✅ |
| T6 | T5 | T5 → T6 | ✅ |
| T7 | T1 | T1 → T7 | ✅ |
| T8 | T1 | T1 → T8 | ✅ |
| T9 | T1 | T1 → T9 | ✅ |
| T10 | T1 | T1 → T10 | ✅ |
| T11 | T3, T10 | T3 → T11, T10 → T11 | ✅ |
| T12 | T4, T7, T11 | T4 → T12, T7 → T12, T11 → T12 | ✅ |
| T13 | T12 | T12 → T13 | ✅ |
| T14 | T8, T9, T13 | T8 → T14, T9 → T14, T13 → T14 | ✅ |
| T15 | T1 | T1 → T15 | ✅ |
| T16 | T4, T14 | T4 → T16, T14 → T16 | ✅ |
| T17 | T15, T16 | T15 → T17, T16 → T17 | ✅ |
| T18 | T17 | T17 → T18 | ✅ |
| T19 | T8, T12 | T12 → T19, T8 → T19 | ✅ |
| T20 | T1, T9 | T1 → T20, T9 → T20 | ✅ |
| T21 | T20 | T20 → T21 | ✅ |
| T22 | T20 | T20 → T22 | ✅ |
| T23 | T2, T17, T21, T22 | os quatro → T23 | ✅ |

Nenhuma task marcada `[P]` depende de outra `[P]` da mesma fase: T7, T8, T9, T10, T15 dependem só de T1; T21 e T22 dependem só de T20; T19 depende de T8 e T12, ambas concluídas antes da fase em que corre.

### Check 3 — Co-locação de testes

| Task | Camada criada | Matriz exige | Task declara | Status |
|---|---|---|---|---|
| T1 | Infra de build | none | none | ✅ |
| T2 | Infra declarativa | none | none | ✅ |
| T3 | Schema e migrações | integration | integration | ✅ |
| T4 | Contexto de tenant | integration | integration | ✅ |
| T5 | Schema e policies | integration | integration | ✅ |
| T6 | Schema (verificação) | integration | integration | ✅ |
| T7 | Domínio puro | unit | unit | ✅ |
| T8 | Domínio puro | unit | unit | ✅ |
| T9 | Contratos | unit | unit | ✅ |
| T10 | Config | unit | unit | ✅ |
| T11 | Bootstrap + controller | e2e | e2e | ✅ |
| T12 | Repositório | integration | integration | ✅ |
| T13 | Repositório | integration | integration | ✅ |
| T14 | Serviço de aplicação | integration | integration | ✅ |
| T15 | Domínio de apoio, sem I/O | unit | unit | ✅ |
| T16 | Guard | e2e | e2e | ✅ |
| T17 | Controller | e2e | e2e | ✅ |
| T18 | Guard + serviço | e2e (o maior) | e2e | ✅ |
| T19 | CLI | integration | integration | ✅ |
| T20 | Componentes do painel | unit | unit | ✅ |
| T21 | Componentes do painel | unit | unit | ✅ |
| T22 | Componentes do painel | unit | unit | ✅ |
| T23 | Infra + percurso completo | e2e | e2e | ✅ |

Nenhuma task adia teste para outra. Marcas `[P]` conferem com a avaliação de paralelismo do TESTING.md: nenhuma task com testes `e2e` (T11, T16, T17, T18, T23) recebe `[P]`.

---

## Rastreabilidade

| Requisito | Task |
|---|---|
| ENV-01 | T2, T11, T23 |
| ENV-02 | T11 |
| ENV-03 | T10 |
| ENV-04 | T1, T23 |
| DATA-01, DATA-02, DATA-03 | T3 |
| RLS-01, RLS-06 | T6 |
| RLS-02, RLS-03, RLS-04 | T5 |
| RLS-05 | T4 |
| TNT-01 a TNT-04 | T19 |
| AUTH-01, AUTH-02 | T14, T17 |
| AUTH-03 | T8 |
| AUTH-04 | T12, T16 |
| AUTH-05 | T13, T17 |
| AUTH-06 | T13, T16 |
| AUTH-07 | T16 |
| SHELL-01, SHELL-02, SHELL-04 | T22 |
| SHELL-03 | T21 |
| SHELL-05 | T20 |
| ROLE-01 | T7, T18 |
| ROLE-02, ROLE-03 | T18 |
| RATE-01, RATE-02 | T15, T17 |
| RATE-03 | T15 |

**Cobertura:** 34 de 34 requisitos mapeados para tasks. ✅
