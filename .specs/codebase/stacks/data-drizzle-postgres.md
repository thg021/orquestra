# Camada de dados — Drizzle + Postgres

**Data:** 2026-09-06 · **Pacote:** `packages/db`

| Dependência | Aqui | Última publicada |
| --- | --- | --- |
| `drizzle-orm` | ^0.36.4 | 0.45.2 |
| `drizzle-kit` | ^0.28.1 | 0.31.10 |
| `pg` | ^8.13.1 | 8.23.0 |
| `@testcontainers/postgresql` | ^10.16.0 | 12.1.0 |
| Postgres | 17-alpine (Compose e Testcontainers) | — |

Este documento vale para qualquer agente que toque banco na Orquestra. Ele descreve o que **já existe** no repositório, não boas práticas genéricas.

---

## Regras invioláveis

```
  1  tabela com tenant_id e dado de negócio  ->  RLS enable + force + policy
  2  acesso a dado                           ->  só withTenant / withoutTenant
  3  policy                                  ->  sempre com nullif(...)
  4  DDL  -> orquestra_owner
     DML  -> orquestra_app (NOBYPASSRLS)
  5  o Pool nunca sai de packages/db
  6  segredo em coluna bytea, nunca text
```

Quem impede um escritório de ver o outro é o Postgres, não a query. Se a proteção depender de alguém lembrar de escrever `where tenant_id = ...`, ela não existe.

---

## Como escrever uma migração

```
  edito src/schema/*.ts
        |
        v
  pnpm --filter @orquestra/db exec drizzle-kit generate
        |  (usa DATABASE_MIGRATION_URL = orquestra_owner)
        v
  migrations/000N_nome.sql  +  meta/000N_snapshot.json  +  meta/_journal.json
        |
        v
  leio o SQL gerado antes de commitar
        |
        v
  runMigrations() aplica no boot da api
```

Regras do projeto:

| Regra | Por quê |
| --- | --- |
| O SQL gerado entra no git junto com o snapshot e o `_journal.json` | migração é versionada; sem o snapshot o próximo `generate` produz diff errado |
| Nunca editar migração já aplicada | crie um arquivo novo |
| SQL que o drizzle-kit não gera vai em migração custom: `drizzle-kit generate --custom --name=<nome>` | é onde entram `create extension`, backfill, índice parcial |
| Statements separados por `--> statement-breakpoint` | o migrator quebra o arquivo por esse marcador |
| Nunca `drizzle-kit push` | `push` sincroniza sem histórico; aqui todo DDL é rastreável |

`runMigrations` (`packages/db/src/migrate.ts`) faz duas coisas que importam:

```ts
await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
// ... drizzleMigrate(db, { migrationsFolder })
await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
```

- **Advisory lock:** duas instâncias da api subindo juntas não aplicam a mesma migração duas vezes. A segunda espera e encontra tudo registrado em `drizzle.__drizzle_migrations`.
- **Transação única:** o drizzle agrupa as migrações pendentes numa transação. Se uma falha, o banco volta ao estado anterior.

Migração roda com `DATABASE_MIGRATION_URL` (owner). Nunca com `DATABASE_URL` (app) — o papel da aplicação não tem DDL.

---

## O modelo de policy replicado em toda tabela de tenant

No schema TypeScript (`packages/db/src/schema/service-data.ts`):

```ts
export const serviceRecords = pgTable(
  "service_records",
  { id: uuid("id").primaryKey(), tenantId: uuid("tenant_id").notNull(), /* ... */ },
  (table) => [
    pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`
    })
  ]
).enableRLS();
```

O SQL que sai disso (`migrations/0001_striped_mystique.sql`), linha a linha:

```sql
ALTER TABLE "service_records" ENABLE ROW LEVEL SECURITY;
-- liga a policy para os papéis comuns

CREATE POLICY "tenant_isolation" ON "service_records"
  AS PERMISSIVE FOR ALL TO public
  USING      ("service_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  -- USING filtra a LEITURA: linha de outro tenant simplesmente não existe

  WITH CHECK ("service_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
  -- WITH CHECK barra a ESCRITA com tenant_id diferente do contexto.
  -- Só USING protegeria a leitura e deixaria passar o insert cruzado.

ALTER TABLE "service_records" FORCE ROW LEVEL SECURITY;
-- aplica a policy também ao DONO da tabela. Sem FORCE, orquestra_owner ignora a policy.
```

### Por que `nullif`

`current_setting('app.tenant_id', true)` com o segundo argumento `true` devolve `NULL` em vez de erro quando o setting nunca existiu. Bom. Mas o pool reaproveita conexão, e uma conexão que já rodou `set_config(..., true)` deixa o setting **existindo com string vazia** depois do COMMIT — não inexistente.

```
  conexão nova            current_setting -> NULL   -> comparação NULL -> nada visível   ok
  conexão reaproveitada   current_setting -> ''     -> ''::uuid        -> ERRO 22P02     quebra
  com nullif              ''  ->  NULL              -> comparação NULL -> nada visível   ok
```

Sem o `nullif`, o cast `''::uuid` estoura `invalid input syntax for type uuid` na primeira query fora de contexto numa conexão já usada. Custou tempo na T5 do M0. A forma correta é uma só, e ela se repete idêntica em `using` e em `with check`.

### Isenções

Só duas tabelas carregam `tenant_id` sem RLS: `memberships` e `sessions`. Elas precisam ser lidas **antes** de existir contexto — é a autenticação que produz o contexto. A lista é nomeada e fechada, dentro de `packages/db/test/rls-coverage.int.test.ts`. Não adicione nome nessa lista sem falar com o Thiago.

`tenants` e `users` são globais e nem coluna `tenant_id` têm.

---

## Transações e o contexto de tenant

Existem exatamente dois caminhos, ambos em `packages/db/src/tenant-context.ts`:

| Função | O que faz | Quando usar |
| --- | --- | --- |
| `withTenant(tenantId, fn)` | BEGIN + `set_config('app.tenant_id', $1, true)` + fn + COMMIT | qualquer dado de escritório |
| `withoutTenant(fn)` | BEGIN + fn + COMMIT, sem contexto | tabelas globais (`users`, `sessions`, `tenants`, `memberships`) |

```ts
await withTenant(tenantId, async (tx) => {
  await tx.insert(serviceRecords).values({ id: newId(), tenantId, /* ... */ });
});
```

Detalhes que não são negociáveis:

- **`set_config(..., $1, true)`** — o terceiro argumento `true` é `SET LOCAL`: o setting morre no fim da transação. É isso que impede vazamento entre tenants quando o pool devolve a mesma conexão para outra requisição.
- **Parâmetro vinculado (`$1`)**, nunca interpolação de string. `tenantId` vem de fora; concatenar seria injeção direta no `set_config`.
- **`withoutTenant` não é bypass.** Ele apenas não alimenta a policy — tabelas com RLS retornam zero linha ali dentro.
- **O Pool não é exportado.** `packages/db/src/index.ts` publica só `withTenant`, `withoutTenant`, `getTenantId`, `runMigrations` e `closeDefaultPool`. Regra de lint em `eslint.config.js` fecha o resto do caminho.
- **`getTenantId()`** lê o `AsyncLocalStorage` e serve para log e regra de aplicação. Ele **não** é a proteção — quem decide o que é visível é a policy.
- **SQL cru** dentro de `withTenant` usa o template `sql` do drizzle, que parametriza:

```ts
import { sql } from "drizzle-orm";
await tx.execute(
  sql`select count(*) from ${serviceRecords} where ${serviceRecords.collection} = ${collection}`
);
```

Nunca monte string com concatenação de JavaScript fora do template `sql`.

---

## Colunas binárias e dados sensíveis (M1)

O M1 traz três tabelas de tenant: `service_instances`, `connector_connections`, `connector_bindings`. Todas com o mesmo bloco de RLS acima, sem exceção.

`connector_connections` guarda credencial cifrada em `bytea`:

```ts
import { customType } from "drizzle-orm/pg-core";

// bytea não tem helper nativo no pg-core desta versão — mesmo padrão do citext
// em schema/identity.ts.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  }
});

secretEnvelope: bytea("secret_envelope").notNull(),
dekEnvelope: bytea("dek_envelope").notNull(),
keyVersion: integer("key_version").notNull(),
last4: text("last4").notNull()
```

**Por que `bytea` e não `text`:**

| Motivo | Efeito |
| --- | --- |
| O envelope é `versão‖IV‖tag‖ciphertext` — bytes, não caractere | `text` obrigaria base64: mais 33% de tamanho e uma conversão a mais para errar |
| `text` passa por encoding de cliente e servidor | byte inválido em UTF-8 vira erro ou corrupção silenciosa |
| Legibilidade do esquema | quem lê `bytea` entende na hora que aquilo não é para ser lido |

Regras de manuseio:

- Buffer cifrado entra e sai como `Buffer`. Nada de `.toString()` fora do módulo de cripto.
- `last4` e `metadata` são o que a UI mostra. O envelope nunca sai da camada de dados em claro.
- Nenhum log, mensagem de erro ou objeto serializado carrega envelope, DEK ou KEK. Erro de driver é sanitizado antes de virar log.
- A KEK é arquivo montado (Docker secret) lido em runtime. Ela nunca entra em migração, seed, teste ou conversa.
- Em tabela com envelope, liste as colunas em vez de `select *` — não traga bytes de segredo para dentro do processo sem precisar.

---

## Identificadores

UUID v7 gerado na aplicação por `newId()` (`packages/core/src/id.ts`).

```ts
import { newId } from "@orquestra/core";
await tx.insert(serviceRecords).values({ id: newId(), tenantId, /* ... */ });
```

Nunca `gen_random_uuid()` no default da coluna, nunca `serial`. Motivo: v7 não é sequencial (não revela contagem de clientes) mas é ordenável por tempo, o que preserva localidade de índice. A geração fica na aplicação para o id existir antes do insert.

---

## Como testar

RLS não é simulável em banco de memória. Todo teste de banco sobe um Postgres real via Testcontainers.

`packages/db/test/support/test-database.ts` replica o bootstrap de `docker/postgres/init.sh`:

```
  PostgreSqlContainer("postgres:17-alpine")
        |
        +-- orquestra_owner  (superusuário da imagem)   -> ownerUrl : DDL, migrações
        |
        +-- orquestra_app    NOSUPERUSER NOBYPASSRLS    -> appUrl   : DML, espelha o runtime
                             default privileges: SELECT/INSERT/UPDATE/DELETE
                             CREATE EXTENSION citext
```

Três testes carregam a garantia:

| Teste | Arquivo | O que prova |
| --- | --- | --- |
| Isolamento | `service-records.int.test.ts` | sob contexto de A só linhas de A; escrita com tenant de B é recusada; sem contexto, vazio |
| Cobertura por introspecção | `rls-coverage.int.test.ts` | varre `pg_class` + `pg_policies` e quebra o build nomeando qualquer tabela com `tenant_id` sem `relrowsecurity`, sem `relforcerowsecurity` ou sem policy |
| Vazamento pelo pool | `tenant-context.int.test.ts` | alterna tenants sobre pool `max: 1`; prova que o setting não sobrevive à transação |

O teste de introspecção tem casos de sabotagem: ele cria uma tabela sem RLS dentro do próprio teste e verifica que o gate a acusa. **Tabela nova nasce coberta ou o build cai.** Se ele reprovar, conserte a tabela — nunca a lista de isenção, nunca o teste.

Um teste de tenant sempre usa `appUrl`, não `ownerUrl`. Rodar como owner testaria um cenário que não existe em produção.

Os três projetos de teste rodam em sequência (`pnpm check`): cada um sobe um Postgres, e em paralelo satura a memória do Docker.

---

## Checklist de tabela nova

```
  [ ] tem tenant_id uuid not null?
  [ ] .enableRLS() no pgTable
  [ ] pgPolicy tenant_isolation com using E withCheck, ambos com nullif
  [ ] migração gerada mostra ENABLE + CREATE POLICY + FORCE
  [ ] id populado com newId(), sem default no banco
  [ ] índice por (tenant_id, <coluna de filtro>)
  [ ] segredo em bytea, nunca text
  [ ] rls-coverage.int.test.ts verde
  [ ] acesso escrito só via withTenant
```

---

## Dívida de versão

Estamos nove minors atrás no ORM e três no kit.

| Pacote | Aqui | Atual | Distância |
| --- | --- | --- | --- |
| `drizzle-orm` | 0.36.4 | 0.45.2 | 9 minors |
| `drizzle-kit` | 0.28.1 | 0.31.10 | 3 minors |
| `pg` | 8.13.1 | 8.23.0 | mesma major |
| `@testcontainers/postgresql` | 10.16.0 | 12.1.0 | 2 majors |

**O que ganharíamos**

| Ganho | Onde importa aqui |
| --- | --- |
| `DrizzleQueryError` (0.44) — todo erro de driver embrulhado com query e params | ajuda o log de violação de RLS, mas exige cuidado: params podem carregar dado sensível, e a regra do projeto é log limpo |
| Camada de cache (0.44) | irrelevante no M1; cache com RLS é campo minado |
| `drizzle-kit push --explain`, `--strict` como padrão | não usamos `push`; ganho nulo |
| Evolução do suporte a RLS no pg-core | o `pgPolicy` que já usamos nasceu na 0.36; daqui pra frente é incremental |

**Risco de subir**

```
  drizzle-orm 0.36 -> 0.45   9 minors, cada uma com ajuste de tipo.
                             O risco real não é a query: é o diff de migração.
                             O drizzle-kit compara o schema com meta/*_snapshot.json.
                             Versão nova pode gerar SQL de "correção" para tabela
                             que já está certa — inclusive mexendo em policy.

  @testcontainers 10 -> 12   duas majors; API de start/stop mudou. Toca os três
                             projetos de teste ao mesmo tempo.

  drizzle-orm 1.0            já em beta. Breaking real (ex.: .generatedAlwaysAs()
                             só aceita sql``). Não entrar em beta com o M1 aberto.
```

**Recomendação:** não subir durante o M1. Depois, tratar como task própria: primeiro `drizzle-kit` + `drizzle-orm` juntos (são acoplados pelo formato do snapshot), rodar `generate` e **exigir diff vazio** — qualquer SQL gerado sem mudança de schema é sinal de incompatibilidade de snapshot. Testcontainers em task separada. `pg` pode subir sozinho a qualquer momento.

---

## Referências

- Drizzle ORM — documentação (consultada via context7, `/drizzle-team/drizzle-orm-docs`): https://orm.drizzle.team
- Migrações e SQL custom (`generate --custom`): https://orm.drizzle.team/docs/drizzle-kit-generate
- Arquivo de configuração do kit: https://orm.drizzle.team/docs/drizzle-config-file
- Transações: https://orm.drizzle.team/docs/transactions
- SQL cru parametrizado (`db.execute` + template `sql`): https://orm.drizzle.team/docs/goodies
- Mudanças 0.x → 1.0: https://orm.drizzle.team/docs/pg/v0-v1-changes
- Release 0.44 (`DrizzleQueryError`, cache): https://github.com/drizzle-team/drizzle-orm/releases/tag/0.44.0
- Postgres — Row Security Policies: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- Postgres — `current_setting` / `set_config`: https://www.postgresql.org/docs/17/functions-admin.html
- Postgres — tipo `bytea`: https://www.postgresql.org/docs/17/datatype-binary.html
- RFC 9562 (UUID v7): https://www.rfc-editor.org/rfc/rfc9562
- Neste repo: `.specs/features/foundation/design.md` §Modelo de dados · `.specs/features/pluggable-core/design.md` §Modelo de dados · `docker/postgres/init.sh` · `eslint.config.js` · `CLAUDE.md` §Regras técnicas que já custaram caro
