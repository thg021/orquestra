# Testing

**Status:** Estabelecido no M0 — Fundação
**Data:** 2026-09-05

Este documento é normativo para todos os milestones. Toda task da fase Tasks tira daqui o seu tipo de teste e o seu comando de gate.

---

## Ferramentas

| Item | Escolha | Razão |
|---|---|---|
| Runner | Vitest, em `api`, `web` e pacotes | Um só runner para o monorepo; nativo a ESM/TypeScript, e o mesmo config atende Node e React (jsdom) |
| Postgres dos testes | Testcontainers, container descartável por suíte | Cada rodada aplica as migrações do zero, o que exercita DATA-02 a cada execução; estado não sobrevive entre rodadas |
| HTTP | `supertest` sobre a instância Nest de teste | Exercita o pipeline real (guards, cookies, filtros de erro) |
| Componentes React | `@testing-library/react` + jsdom | Testa comportamento observável, não implementação |

RLS não é simulável com banco em memória. Todo teste que toca policy roda contra Postgres real.

**Injeção de dependência do NestJS sob Vitest.** O Vitest transpila via esbuild, que não emite `design:paramtypes` (a metadata que `emitDecoratorMetadata` produz só quando o `tsc` real roda). Injeção implícita por tipo funciona no `pnpm build` (tsc de verdade) mas falha silenciosamente sob teste — o construtor recebe `undefined`. Por isso todo construtor de controller/provider usa `@Inject(Token)` explícito, nunca só o tipo. Descoberto implementando o bootstrap do M0 (T11).

---

## Test Coverage Matrix

| Camada de código | Onde | Tipo exigido | Por quê |
|---|---|---|---|
| Domínio puro (`packages/core`) | `packages/core/**` | unit | Sem I/O; teste rápido e determinístico |
| Contratos (`packages/contracts`) | `packages/contracts/**` | unit | Schemas Zod: validar aceite e recusa |
| Schema, migrações e policies | `packages/db/**` | integration | Só um Postgres real prova migração e RLS |
| Contexto de tenant (`withTenant`) | `packages/db/tenant-context.ts` | integration | O comportamento sob teste é o do banco e o do pool |
| Repositórios | `apps/api/src/**/*.repository.ts` | integration | Query real contra esquema real |
| Serviços de aplicação | `apps/api/src/**/*.service.ts` | integration | Dependem de repositório e transação |
| Guards, controllers e pipeline HTTP | `apps/api/src/**/*.controller.ts`, `*.guard.ts` | e2e | Cookie, status code e ordem de guard só existem no pipeline montado |
| CLI do operador | `apps/api/src/cli/**` | integration | Efeito é escrita no banco |
| Componentes e rotas do painel | `apps/web/src/**` | unit | API mockada; o que se testa é a rota protegida e o estado da tela |
| Config e bootstrap | `apps/api/src/config/**`, `main.ts` | unit (config) / e2e (bootstrap) | Validação de env é função pura; ordem do boot precisa do processo real |
| Infra declarativa | `docker/**`, `.env.example` | none | Verificado pelo teste de subida ponta a ponta (ENV-01) |

**Regra de co-locação:** a task que cria ou altera uma camada escreve os testes daquela camada **na mesma task**. "Será testado em outra task" não é justificativa aceita.

---

## Gate Check Commands

| Gate | Comando | Quando |
|---|---|---|
| quick | `pnpm typecheck && pnpm test:unit` | Task cujo tipo de teste é `unit` |
| full | `pnpm check` (= `pnpm lint && pnpm typecheck && pnpm test`) | Task cujo tipo é `integration` ou `e2e` |
| build | `pnpm build` | Task que só mexe em configuração de build ou infra |

Scripts na raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:int`, `pnpm test:e2e`, `pnpm test` (os três), `pnpm check`, `pnpm build`. Qualquer etapa que falhe encerra com código diferente de zero (ENV-04).

---

## Parallelism Assessment

| Tipo | Parallel-safe | Razão |
|---|---|---|
| unit | Sim | Sem estado compartilhado |
| integration | Sim | Um container Postgres por arquivo de suíte; nenhum banco compartilhado |
| e2e | **Não** | Compartilham a instância da aplicação e a porta HTTP; rodam em série |

Consequência para a fase Tasks: **task cujo tipo de teste é `e2e` não recebe a marca `[P]`**, mesmo quando o código dela não depende de nenhuma outra.

---

## Testes que são gate de segurança da plataforma

Não são testes comuns: existem para impedir uma classe inteira de regressão, e nenhum milestone posterior pode desativá-los.

1. **Isolamento entre tenants** — sob contexto de A, linhas de B são invisíveis; escrita cruzada é recusada; sem contexto o retorno é vazio.
2. **Cobertura de RLS por introspecção** — falha nomeando qualquer tabela que tenha coluna `tenant_id` sem `relrowsecurity`, sem `relforcerowsecurity` ou sem policy. É o que protege M1 a M4.
3. **Vazamento de contexto pelo pool** — pool com `max: 1` alternando tenants prova que o setting não sobrevive à transação.
4. **Contenção de segredo** (a partir do M1) — falha se o valor de uma credencial conhecida aparecer em prompt, payload de job, `RunStep`, log ou resposta de API. Exigido pelo ADR-001.
