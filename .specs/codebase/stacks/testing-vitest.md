# Como escrever um bom teste na Orquestra

**Status:** vigente
**Data:** 2026-09-06
**Escopo:** este documento fala de **como escrever** o teste. Como o teste **roda** (comandos, gates, matriz de cobertura por camada) está em [`../TESTING.md`](../TESTING.md) — normativo, não repetido aqui.

| Ferramenta | Versão |
|---|---|
| vitest | `^2.1.8` (rodando 2.1.9) |
| @testcontainers/postgresql | `^10.16.0` |
| supertest | `^7.0.0` |
| @testing-library/react | `^16.0.1` |
| jsdom | `^25.0.1` |

---

## Regras invioláveis

```
  1. teste primeiro      escrevo o teste antes da linha de produção
  2. ver falhar          rodo e leio a mensagem de falha; ela precisa
                         descrever o defeito real
  3. código mínimo       só o suficiente para o teste passar
  4. guarda morde        teste-guarda só vale depois de eu quebrar o
                         sistema de propósito e ver o teste apontar o dedo
```

Um teste que nunca foi visto vermelho não é teste — é um `expect` decorativo. Se o passo 2 foi pulado, o teste não existe.

---

## As quatro camadas

O projeto tem quatro projetos Vitest. O sufixo do arquivo é o que decide onde ele cai.

| Projeto | Sufixo | Ambiente | O que vai aqui | Custo |
|---|---|---|---|---|
| `unit` | `*.unit.test.ts` | node | domínio puro, schemas Zod, config, throttle, fronteiras de pacote | ms |
| `unit:web` | `*.unit.test.tsx` | jsdom | componente e rota do painel, API mockada | ms |
| `integration` | `*.int.test.ts` | node | migração, RLS, `withTenant`, repositório, serviço, CLI | Postgres real |
| `e2e` | `*.e2e.test.ts` | node | pipeline HTTP montado: guard, cookie, status code, ordem de filtro | Postgres + app |

Regra de escolha:

```
  precisa de Postgres?  ── não ──> unit
        │ sim
        v
  precisa do pipeline HTTP do Nest montado?  ── não ──> integration
        │ sim
        v
      e2e
```

Escolha sempre a camada mais barata que ainda prova a coisa. Testar `newId()` em `e2e` é desperdício; testar policy de RLS em `unit` é mentira — RLS não é simulável fora do Postgres.

**Os três comandos rodam em sequência.** `pnpm test` é `test:unit && test:int && test:e2e`. Nunca `vitest run` direto no workspace: `integration` e `e2e` são projetos distintos e o Vitest roda projetos **concorrentes por padrão**. Cada suíte sobe seu próprio Postgres via Testcontainers; concorrer satura a memória do Docker Desktop e produz timeout e `pool` undefined em `afterAll` — sintoma de contenção, não de bug. `fileParallelism: false` resolve só *dentro* de um projeto. (Custou a T17 do M0.)

---

## Como nomear

O nome do teste é uma frase em português que descreve **o comportamento observável**, não o método chamado. Quem lê a saída vermelha do CI precisa entender o defeito sem abrir o arquivo.

```
  describe  o sujeito         "withTenant / withoutTenant"
  it        o comportamento   "estabelece o setting no escopo da
                               transação e o commit encerra o contexto"
```

Bons exemplos, todos do projeto:

| Arquivo | Nome |
|---|---|
| `packages/core/test/id.unit.test.ts` | `produz um UUID v7 válido (versão e variante corretas)` |
| `packages/catalog/test/secret.unit.test.ts` | `sobrevive à conversão para JSON Schema, que é o que o painel lê` |
| `packages/db/test/tenant-context.int.test.ts` | `com pool max: 1, operações alternando tenant A e B não vazam contexto entre transações` |
| `apps/web/test/components/protected-route.unit.test.tsx` | `visitante não autenticado é redirecionado ao login` |

Maus exemplos (não existem no repo — mantenha assim):

| Ruim | Por quê | Vira |
|---|---|---|
| `it("newId")` | não diz nada | `produz um UUID v7 válido` |
| `it("funciona")` | falha não informa | `abaixo do limite, check() não lança` |
| `it("testa o guard")` | descreve a atividade, não o resultado | `sem cookie de sessão responde 401` |
| `it("should return true")` | inglês e detalhe de retorno | `usuário sem membership não acessa o tenant` |

Identificadores em inglês, texto que humano lê em português — inclusive o nome do teste.

---

## O que NÃO testar

| Não teste | Por quê | Teste em vez disso |
|---|---|---|
| método privado | não é contrato; muda com refactor | o efeito observável na superfície pública |
| que o dublê foi chamado, e só isso | prova que o mock existe, nada mais | o resultado que a chamada produziu |
| forma interna do estado (nome de campo, ordem de query) | congela a implementação | o comportamento que o usuário percebe |
| biblioteca de terceiro | Zod, pg e o Nest já têm suíte própria | o **seu** uso deles (ex.: o schema aceita e recusa o que deve) |
| markup exato do React | quebra a cada ajuste de layout | papel acessível e texto: `getByRole("status")`, `getByText` |

Regra prática: se renomear uma variável interna quebra o teste, o teste está errado.

---

## Dublê ou real?

```
  é lento, externo ou não determinístico?  ── não ──> use o real
        │ sim
        v
  dá para substituir na fronteira do módulo?  ── sim ──> vi.mock na fronteira
        │ não
        v
  Testcontainers (banco de verdade)
```

| Situação | Decisão | Exemplo no projeto |
|---|---|---|
| Postgres, RLS, migração | **real**, sempre | `packages/db/test/*.int.test.ts` |
| HTTP do Nest | **real**, via `supertest` sobre a app montada | `apps/api/test/auth/session-guard.e2e.test.ts` |
| chamada à API no painel | **dublê** — a única fronteira mockada do web | `vi.mock("../../src/api/client")` em `protected-route.unit.test.tsx` |
| relógio | **fake timers** | `AuthThrottle` em `throttle.unit.test.ts` |
| domínio puro (`core`, `catalog`) | **nada de dublê** — não tem I/O | `id`, `password`, `secret` |

Padrão de dublê parcial, quando só uma função da fronteira precisa cair:

```ts
vi.mock("../../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/client")>("../../src/api/client");
  return { ...actual, apiFetch: vi.fn() };
});
```

Higiene obrigatória — dublê que vaza entre testes é a fonte número um de teste fantasma:

```ts
afterEach(() => {
  cleanup();            // React: desmonta a árvore
  vi.clearAllMocks();   // zera chamadas
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());   // sempre devolva o relógio
```

`vi.spyOn` sobre objeto real pede `mockRestore()` (ou `vi.restoreAllMocks()`) — `clearAllMocks` limpa chamadas mas não devolve o método original.

### Assíncrono e tempo

- Erro de promessa: `await expect(fn()).rejects.toThrow(RateLimitedError)` — nunca `try/catch` com `expect` no `catch` (passa quando não lança).
- Com fake timers, monte a asserção **antes** de avançar o relógio, senão a rejeição vira unhandled:

```ts
const assertion = expect(promise).rejects.toThrow("boom");
await vi.advanceTimersByTimeAsync(100);
await assertion;
```

- Espera de UI: `waitFor` da Testing Library. Nunca `setTimeout` no teste.
- `hookTimeout: 180_000` já está configurado em `integration` e `e2e` porque subir container é lento. Não copie esse número para um teste `unit`: teste unitário lento é teste mal desenhado.

---

## Testes-guarda

Um teste-guarda não protege uma função. Protege uma **propriedade do sistema inteiro** contra uma classe de regressão que ninguém vai lembrar de checar daqui a seis meses.

Os que existem hoje:

| Guarda | Onde | Propriedade protegida |
|---|---|---|
| cobertura de RLS por introspecção | `packages/db/test/rls-coverage.int.test.ts` | nenhuma tabela com `tenant_id` nasce sem `ENABLE`, `FORCE` e policy |
| isolamento entre tenants | `packages/db/test/tenant-context.int.test.ts` | sob contexto de A, linha de B é invisível; escrita cruzada recusada |
| vazamento pelo pool | idem, caso `max: 1` | o setting não sobrevive à transação |
| fronteira de pacote | `packages/catalog/test/boundaries.unit.test.ts` | `catalog` não importa NestJS nem `@orquestra/db` |
| contenção de segredo (M1) | a escrever | valor de credencial não aparece em resposta, log, prompt, job ou coluna |

### Como escrever um

```
  1. escreva a propriedade em uma frase       "toda tabela com tenant_id tem RLS completa"
  2. descubra o fato, não a lista             pergunte ao pg_catalog / varra o diretório
  3. asserção contra vazio                    expect(gaps).toEqual([])
  4. mensagem que NOMEIA o culpado            o dev que quebrar precisa saber a tabela
  5. isenções explícitas e comentadas         cada uma com o porquê no código
```

O guarda descobre o universo sozinho. Ele não recebe a lista de tabelas nem a lista de arquivos — ele consulta `pg_class`/`information_schema` ou anda no diretório. É por isso que ele pega a tabela que **ainda não existe**.

Isenção é lista curta, nomeada e justificada no próprio arquivo:

```ts
/** memberships e sessions são lidos ANTES de existir contexto de tenant. */
const GLOBAL_TABLES_EXEMPT_FROM_RLS = new Set(["memberships", "sessions"]);
```

### Provar que morde

**Esta é a parte que não é opcional.** Um guarda que não foi visto acusar é um guarda quebrado silencioso — passa verde para sempre e ninguém percebe.

Duas formas de provar, nesta ordem de preferência:

**1. Sabotagem dentro do próprio teste** (preferida — vira regressão permanente). É o que `rls-coverage` faz: cria uma tabela ruim, verifica que o detector a nomeia, e limpa no `finally`.

```ts
it("falha nomeando uma tabela criada com tenant_id sem nenhuma proteção de RLS", async () => {
  await client.query(`create table "sabotage_no_rls" (id uuid primary key, tenant_id uuid not null)`);
  try {
    const gaps = await findRlsCoverageGaps(client);
    expect(gaps.find((g) => g.table === "sabotage_no_rls")?.missing).toEqual(
      expect.arrayContaining(["ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY", "policy"])
    );
  } finally {
    await client.query('drop table "sabotage_no_rls"');
  }
});
```

Repare que existe também o caso **parcial** — RLS ligada mas sem `FORCE` e sem policy. Guarda bom morde no meio do caminho, não só no zero absoluto.

**2. Sabotagem manual registrada.** Quando não dá para sabotar em código (ex.: fronteira de pacote), quebre de propósito na sua máquina — adicione `import { Injectable } from "@nestjs/common"` em `packages/catalog/src`, rode, veja vermelho, desfaça — e registre no `STATE.md` que a mordida foi verificada, com a data.

Nunca desative um guarda para o build passar. Conserte o que ele apontou. (Regra do `CLAUDE.md`.)

### O guarda de segredo (M1)

Regra específica, e é a que mais gente erra:

```
  ERRADO   procurar pelo NOME do campo   ("apiKey", "password", "token")
  CERTO    procurar pelo VALOR semeado   ("sk-test-9f3a-CANARIO")
```

Buscar por nome só encontra o que você já sabia que existia. Buscar pelo valor pega o campo novo com nome inocente — `metadata`, `payload`, `descricao` — que alguém adicionou sem pensar.

Desenho do teste:

```
  semeia credencial com valor-canário improvável
        │
        v
  exercita o caminho: cria conexão, roda o job, chama a API
        │
        v
  varre TUDO procurando o canário:
     · corpo de toda resposta HTTP capturada
     · log capturado do processo
     · payload de job e RunStep
     · TODA coluna de texto/json de TODA tabela   <- via introspecção, não lista fixa
        │
        v
  expect(ocorrencias).toEqual([])   nomeando tabela.coluna onde vazou
```

A varredura do banco também é por introspecção. Coluna nova entra na varredura sozinha — mesma lógica do guarda de RLS.

---

## Postgres real via Testcontainers

Todo teste `int`/`e2e` que toca banco usa `startTestDatabase()` (`packages/db/test/support/test-database.ts`). Não suba container à mão.

O helper replica `docker/postgres/init.sh` e entrega **duas** conexões:

| URL | Papel | Para quê |
|---|---|---|
| `ownerUrl` | `orquestra_owner` | DDL, migrações, introspecção |
| `appUrl` | `orquestra_app` (`NOBYPASSRLS`) | tudo que simula o runtime |

**Teste de isolamento sempre pelo `appUrl`.** O owner ignora RLS: um teste de policy conectado como owner passa mesmo com o isolamento quebrado — falso verde perfeito.

Esqueleto padrão:

```ts
let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
  await runMigrations({ connectionString: db.ownerUrl });
}, 180_000);          // <- o timeout do hook vai no 2º argumento

afterAll(async () => {
  await pool.end();   // feche o pool ANTES do container
  await db.close();
});
```

Mais:

- Container por arquivo de suíte. Não compartilhe container entre arquivos — estado de um vaza no outro.
- Migração roda do zero a cada rodada. É de propósito: exercita a migração toda vez.
- Não limpe tabela entre testes com `truncate` global; prefira dados por tenant com UUID distinto por caso.
- `e2e` seta `process.env.DATABASE_URL = db.appUrl` antes de montar a app, e usa `NestFactory.create(TestModule, { logger: false })` com módulo de teste mínimo — só o controller sob teste.
- Construtor de provider/controller usa `@Inject(Token)` explícito. O esbuild do Vitest não emite `design:paramtypes`, e a injeção implícita entrega `undefined` só no teste. (T11 do M0.)

---

## Dívida de versão

O projeto está em **Vitest 2.1.9**. A configuração de projetos está em `vitest.workspace.ts` com `defineWorkspace`.

| Versão | Situação do arquivo de workspace |
|---|---|
| 2.x (hoje) | `vitest.workspace.ts` + `defineWorkspace` — suportado, sem aviso |
| 3.2 | **depreciado.** Substituído por `test.projects` na config raiz; ainda funciona, mas emite aviso |
| 4.x | **removido.** `test.workspace` lança erro pedindo migração para `test.projects`; arquivo `vitest.workspace.*` não é mais lido |

Nada a fazer agora. Quando subirmos para 3.2+, a migração é mecânica: mover os quatro blocos para dentro de `test.projects` num `defineConfig` na raiz.

```ts
// vitest.config.ts (destino futuro)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit",        /* ... igual ao de hoje ... */ } },
      { test: { name: "unit:web",    /* ... */ } },
      { test: { name: "integration", /* ... */ } },
      { test: { name: "e2e",         /* ... */ } }
    ]
  }
});
```

Ganho colateral: opções globais (reporter, coverage) passam a viver num lugar só. O que **não** muda: projetos continuam concorrentes por padrão, então `pnpm test` segue sequencial nos três comandos.

Outros pontos a revisitar na subida de major:

- `restoreMocks: true` na config global resolveria de vez o `afterEach` manual de dublê. Vale avaliar já no 2.x.
- Vitest 3+ traz `vi.waitFor` integrado com fake timers — hoje o painel depende do `waitFor` da Testing Library.

---

## Referências

- Vitest — Test Projects (guia): https://vitest.dev/guide/projects
- Vitest 3.2 release, seção "workspace is Deprecated": https://github.com/vitest-dev/vitest/blob/main/docs/blog/vitest-3-2.md
- Vitest 4 — remoção de `test.workspace`: https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/node/config/resolveConfig.ts
- Vitest — Mock Functions e `restoreMocks`: https://vitest.dev/guide/mocking
- Vitest — Fake Timers: https://vitest.dev/guide/mocking/timers
- Vitest — `expect().rejects` e rejeição não tratada com timers: https://vitest.dev/api/expect
- Vitest — Waiting for Async Conditions (`vi.waitFor`): https://vitest.dev/guide/recipes/wait-for
- Interno: [`../TESTING.md`](../TESTING.md), `CLAUDE.md`, `.specs/project/STATE.md`
