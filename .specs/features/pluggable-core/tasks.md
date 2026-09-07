# M1 — Núcleo plugável: Tasks

**Design:** `.specs/features/pluggable-core/design.md`
**Spec:** `.specs/features/pluggable-core/spec.md`
**Testing:** `.specs/codebase/TESTING.md`
**Status:** Em andamento — 16 de 25 tasks (T1 a T16 concluídas em 06/09/2026) — US1 e US4 fechadas; US2 com backend pronto, falta o painel (T19-T21)

25 tasks. Uma entrega por task, com teste co-locado.

---

## Execution Plan

### Fase 1 — Catálogo (destrava quase tudo)

```
T1 ──► T2 ──► T3 ──► T4
```

### Fase 2 — Cofre (paralela à Fase 1)

```
T5 ──► T6 ──► T7 ──► T8
```

### Fase 3 — Persistência

```
T1 ──┐
     ├──► T9 ──► T10
T6 ──┘
```

### Fase 4 — API de instâncias (paralela à Fase 5)

```
T10 ──┬──► T11 ──► T13 ──┐
      │                   ├──► T14
T2  ──┴──► T12 ──────────┘
T10 ──► T15  [P]
```

### Fase 5 — API de conexões

```
T10 ──┬──► T16 ──► T17 ──► T18
T7  ──┘
```

### Fase 6 — Painel

```
T4  ──► T19 ──┬──► T20 ──► T21
              └──► T22
T14, T18 ─────────────────► T21, T22
```

### Fase 7 — Gates do milestone

```
T18, T21, T22 ──┬──► T23
                ├──► T24
                └──► T25
```

---

## Task Breakdown

### T1: Pacote `packages/catalog` com o contrato de extensão

**What:** pacote novo no workspace com `defineAgent`, `defineConnector`, o marcador `secret()` e os tipos de `Capability`, `AgentDefinition` e `ConnectorDefinition`. Sem definições reais ainda.
**Where:** `packages/catalog/src/{index.ts,capabilities.ts,define.ts,secret.ts,errors.ts}`
**Depends on:** —
**Reuses:** regra de dependência do M0 (`catalog → core`, nunca NestJS)
**Requirement:** CAT-01, CAT-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `defineAgent` e `defineConnector` recusam, em tempo de chamada, definição sem chave, sem versão em semver ou sem capability
- [x] `secret()` anota o campo sem alterar o tipo inferido pelo Zod
- [x] Teste de fronteira confirma que o pacote não importa NestJS nem `packages/db`

**Feito em 06/09/2026.** 19 testes. `secret()` virou `.meta({ secret: true })` do Zod 4 — a marca atravessa o `z.toJSONSchema()` e chega ao painel, em vez do `.describe()` estruturado que o design previa. `defineConnector` também recusa conector que não marque nenhum campo secreto.

---

### T2: Validação do catálogo e derivação de JSON Schema

**What:** `validateCatalog()` reprovando chave duplicada, versão fora de semver, capability órfã e schema fora do subconjunto do formulário; e a conversão Zod → JSON Schema que o painel consome.
**Where:** `packages/catalog/src/{validate.ts,json-schema.ts}`
**Depends on:** T1
**Reuses:** `z.toJSONSchema()` nativo do Zod 4 — sem dependência extra
**Requirement:** CAT-03, CAT-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Cada uma das quatro classes de problema tem teste próprio e é reportada nomeando o culpado
- [x] O subconjunto suportado do design (texto, enum, número, booleano, lista de texto, objeto de um nível) converte; qualquer outro construto é reprovado
- [x] Campos marcados com `secret()` chegam anotados no JSON Schema

**Feito em 06/09/2026.** 12 testes novos (31 no pacote). `validateCatalog` revalida chave e versão mesmo em definições que não passaram por `defineAgent`/`defineConnector` — é a última linha de defesa antes do boot. `checkFormSchemaSupport` percorre o JSON Schema derivado e reprova aninhamento de objeto, lista de não-texto e qualquer construto fora do subconjunto (`z.map`, por exemplo).

---

### T3: Definições reais do catálogo

**What:** o `AgentDefinition` de `accounting-routine` (config, capabilities obrigatórias e opcionais, `data_collections`, sem grafo) e os seis `ConnectorDefinition`: `platform-upload`, `onedrive`, `google-drive`, `gmail`, `whatsapp`, `fortes-conecta`.
**Where:** `packages/catalog/src/agents/accounting-routine.ts`, `packages/catalog/src/connectors/*.ts`
**Depends on:** T2
**Reuses:** skill `rotina-contabil` como fonte da configuração que o agente precisa
**Requirement:** CAT-01, CAT-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `validateCatalog()` passa com as definições reais carregadas
- [x] Toda capability exigida pelo agente é satisfeita por ao menos um conector
- [x] Campos de credencial de cada conector estão marcados com `secret()`; `baseUrl` e afins não

**Feito em 06/09/2026.** 41 testes novos (72 no pacote). Duas decisões tomadas nesta task, confirmadas com o usuário:

- `caminho_base_local` do `clientes.yaml` **não** virou campo de configuração — é a capability `file-storage`, resolvida pela conexão. `tipos_documento`/`categorias_documentos` também não são configuráveis: são regra de negócio fixa, extraída para código testável no M4.
- Conectores OAuth (`onedrive`, `google-drive`, `gmail`) usam `authKind: oauth` mas o `authSchema` do M1 pede um `refreshToken` colado à mão — ponte até o fluxo real do M3, que substitui o formulário por um botão sem mudar o formato salvo no cofre.
- O canal de contato de um cliente na coleção `customers` reaproveita o vocabulário de capability de saída (`email`/`messaging`/`document-delivery`) em vez de inventar um enum novo — é a mesma escolha "por destinatário" do design §4, expressa dado a dado.
- Nomes de campo em inglês (`signature`, `defaultDeadline`, `defaultCc`), rótulo em português via `.meta({ title })` — D12 aplicada ao schema de configuração pela primeira vez.

---

### T4: Endpoints de catálogo e validação no boot

**What:** `CatalogController` servindo `GET /catalog/agents` e `/catalog/connectors`, e a chamada de `validateCatalog()` na inicialização, derrubando o processo com a lista de problemas.
**Where:** `apps/api/src/catalog/`, `apps/api/src/main.ts`
**Depends on:** T3
**Reuses:** padrão de boot do M0 (`loadConfig` → migrações → escuta)
**Requirement:** CAT-01, CAT-02, CAT-03, CAT-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] As duas rotas devolvem o catálogo com JSON Schema embutido
- [x] Catálogo inválido encerra o processo com código diferente de zero, listando todos os problemas
- [x] Nenhuma consulta a banco participa da resposta do catálogo
- [x] `@Inject(Token)` explícito em todo construtor (convenção do M0 em `TESTING.md`) — não se aplica: `CatalogController` não tem construtor, de propósito (catálogo é código, não precisa de nada injetado)

**Feito em 06/09/2026.** `validateBuiltinCatalog()` roda logo após `loadConfig`, antes das migrações — catálogo quebrado nem tenta tocar o banco. O teste que prova CAT-05 usa `runMigrationsFn` como stub e nunca sobe um Postgres real, o que já é a prova de que a rota não depende de banco. Fecha a US1.

---

### T5: Carregamento da KEK

**What:** leitura da KEK do arquivo apontado por `KEK_FILE`, com suporte a múltiplas versões ativas, e falha de inicialização quando ausente ou malformada.
**Where:** `packages/core/src/vault/kek.ts`, `apps/api/src/config/`, `.env.example`, `docker/compose.yml`
**Depends on:** —
**Reuses:** `loadConfig` do M0
**Requirement:** SEC-02, ROT-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] KEK montada como Docker secret em arquivo, nunca como variável de ambiente
- [x] Ausência, permissão negada ou tamanho inválido encerram o processo nomeando o problema, sem imprimir conteúdo
- [x] Mais de uma versão de KEK pode coexistir, indexada por número de versão

**Feito em 06/09/2026.** `loadKeks()` em `packages/core/src/vault/kek.ts` — um arquivo por versão, nome do arquivo é o número da versão (aceita binário cru de 32 bytes ou hex de 64 caracteres). `bootstrap()` chama isso logo após validar o catálogo, antes das migrações. Testado ao vivo no Docker Compose: sem o secret montado, a API recusa subir e reinicia em loop com `InvalidKekError`, sem imprimir nenhum byte da chave; com o secret presente, sobe normal. `docker/secrets/kek/` é gitignorado (só `.gitkeep` versionado).

---

### T6: Cofre — `seal` e `open`

**What:** derivação da chave de tenant por HKDF, geração de DEK, cifragem AES-256-GCM com AAD, e o formato de envelope binário do design.
**Where:** `packages/core/src/vault/{seal.ts,envelope.ts,index.ts}`
**Depends on:** T5
**Reuses:** `node:crypto` — sem dependência nova
**Requirement:** SEC-01, SEC-02, SEC-06, SEC-07

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `open(seal(x)) === x` para segredos de tamanhos variados, incluindo unicode
- [x] O mesmo plaintext em dois tenants produz envelopes diferentes
- [x] Envelope de um tenant não abre sob outro tenant nem sob outro `connection_id` (o AAD falha)
- [x] Nenhuma mensagem de erro do módulo contém plaintext, chave ou envelope — com teste que verifica

**Feito em 06/09/2026.** `createVault(keks)` devolve `{ seal, open }`. Refinamento sobre o design: o AAD da DEK amarra tenant+conexão+versão de KEK (é o que muda no rewrap da T7); o AAD do segredo amarra só tenant+conexão, sem a versão — porque a DEK em si nunca muda numa rotação, e se o AAD do segredo dependesse da versão de KEK, rotacionar exigiria recifrar o segredo também, quebrando a promessa de "sem tocar o secret_envelope". Documentado como D34 no STATE. 15 testes novos (33 no pacote).

---

### T7: Cofre — recifragem de DEK

**What:** `rewrapDek` abrindo a DEK sob uma versão de KEK e recifrando sob outra, sem tocar o `secret_envelope`.
**Where:** `packages/core/src/vault/rewrap.ts`
**Depends on:** T6
**Reuses:** T6
**Requirement:** ROT-04, ROT-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Após recifrar, `open` continua devolvendo o mesmo plaintext
- [x] O `secret_envelope` é byte a byte idêntico ao anterior
- [x] Conexões em v1 e em v2 convivem legíveis no mesmo conjunto

**Feito em 06/09/2026.** `rewrapDek` abre a DEK sob a versão antiga e recifra sob a nova, devolvendo um `SealedSecret` com `secretEnvelope` intocado (comparado byte a byte no teste). As funções de cifragem (`encrypt`/`decrypt`/AAD) saíram de `seal.ts` para `gcm.ts` compartilhado, sem mudar comportamento — só para não duplicar entre `seal.ts` e `rewrap.ts`. 8 testes novos (41 no pacote).

---

### T8: Comando `kek:rotate`

**What:** comando de operador que percorre as conexões abaixo da versão alvo e recifra suas DEKs, idempotente e retomável.
**Where:** `apps/api/src/cli/kek-rotate.ts`
**Depends on:** T7, T10
**Reuses:** CLI do operador do M0
**Requirement:** ROT-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Interromper no meio deixa as duas versões convivendo, ambas legíveis
- [x] Rodar de novo conclui o trabalho e é inofensivo quando não há mais o que fazer
- [x] Nenhum plaintext de segredo é decifrado durante a rotação

**Feito em 06/09/2026.** `runKekRotate` varre todo tenant (via `withoutTenant` na tabela global `tenants`) e, para cada um, cada conexão pendente é uma transação própria (`withTenant` por conexão) — interromper no meio deixa parte já na versão nova e parte na antiga, ambas legíveis, porque a KEK antiga continua carregada enquanto convivem. Idempotente por construção: a consulta `key_version < toVersion` já pula sozinha o que uma execução anterior deixou pronto, sem precisar de arquivo de progresso. Ligado à CLI como `kek:rotate --to-version <n>`.

Achado de teste: os quatro cenários (interrupção, retomada, no-op, secret_envelope intocado) só ficaram estáveis depois de isolar tenant e diretório de KEK por teste — a suíte varre *todo* tenant do banco, então sobra de um teste contaminava o próximo. Lição registrada no STATE.

---

### T9: Migração das tabelas do M1 com RLS

**What:** schema Drizzle e migração SQL de `service_instances`, `connector_connections` e `connector_bindings`, com `enable`+`force` RLS, policies, índices e restrições únicas do design.
**Where:** `packages/db/src/schema/*.ts`, `packages/db/migrations/`
**Depends on:** T1, T6
**Reuses:** padrão de policy do M0, com `nullif(current_setting(...), '')::uuid`
**Requirement:** SEC-07, INST-01, BIND-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] O teste de introspecção de RLS do M0 passa a cobrir as três tabelas sem alteração no próprio teste
- [x] Segredo e DEK são `bytea`; `key_version` é coluna própria e consultável
- [x] Única por `(service_instance_id, capability)` impede dois vínculos na mesma capability

**Feito em 06/09/2026.** Migração `0002_icy_living_tribunal.sql` gerada por `drizzle-kit generate` e validada de ponta a ponta num Postgres real antes de commitar (não só pelo teste). O `drizzle-kit` 0.28 não gera `FORCE ROW LEVEL SECURITY` — acrescentado à mão nas três tabelas, mesma lacuna já conhecida do M0. Um teste do M0 (`migrate.int.test.ts`) contava o total de FKs do banco inteiro e quebrou com a chegada de `connector_bindings` (que legitimamente tem FK); corrigido para restringir à checagem que o teste realmente queria provar (FKs de `memberships`/`sessions`), sem perder cobertura. 6 testes de integração novos. Suíte completa verde: lint, typecheck, 152 unitários, 51 integração, 27 e2e.

---

### T10: Repositórios sob contexto de tenant

**What:** repositórios de instâncias, conexões e bindings, todos passando por `withTenant`, sem nenhum caminho alternativo ao pool.
**Where:** `packages/db/src/repositories/*.ts`
**Depends on:** T9
**Reuses:** `withTenant` do M0
**Requirement:** INST-01 a INST-06, SEC-01, BIND-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Teste de integração confirma leitura cruzada vazia entre dois tenants nas três tabelas
- [x] Regra de lint continua impedindo importar o pool fora de `packages/db`
- [x] Listagem padrão de instâncias omite as removidas

**Feito em 06/09/2026.** Três repositórios em `packages/db/src/repositories/`, todos passando por `Tx` de `withTenant`/`withoutTenant` — nenhum importa `pool.ts` diretamente. `bindConnectorCapability` usa `ON CONFLICT DO UPDATE` em `(service_instance_id, capability)`: ligar de novo substitui a linha em vez de somar (BIND-02), testado explicitamente. `listBindingsByConnection` já existe pensando na T17 (revogação precisa achar rápido quem depende de uma conexão). 15 testes de integração novos, cobrindo isolamento nas três tabelas, o upsert do binding, e a listagem que omite instância removida.

De passagem: corrigido um aviso de depreciação do TypeScript (`moduleResolution=node10`) que apareceu ao rodar a suíte — `ignoreDeprecations: "5.0"` no `tsconfig.base.json`, sem mudar a resolução de módulo de verdade (o projeto continua CommonJS, incompatível com trocar para `Node16`/`NodeNext` sem uma migração maior).

---

### T11: Serviço de instâncias — instalar, configurar, remover

**What:** `install`, `update` (nome e config, validada contra o schema da versão fixada) e `remove` lógico.
**Where:** `apps/api/src/service-instances/`
**Depends on:** T10
**Reuses:** catálogo (T2) para validar config
**Requirement:** INST-01, INST-02, INST-04, INST-05, INST-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Config inválida devolve 422 com os campos e motivos, sem gravar
- [x] A validação usa a versão fixada na instância, não a mais recente do catálogo
- [x] Remoção preserva a linha e os vínculos, e some da listagem

**Feito em 06/09/2026.** `POST/GET/PATCH/DELETE /service-instances`. `owner`/`admin` escrevem via `@RequireRole("admin")`; `operator` só lê via `@Protected()`. `ErrorFilter` ganhou um campo `fields` opcional no corpo de erro — só repassado quando a exceção HTTP carrega essa chave, nunca o payload inteiro sem filtro. `update()` busca a definição pela chave+versão FIXADA na instância (`findAgentDefinition`, novo em `packages/catalog`), não pela mais recente do catálogo — recusa com `AGENT_VERSION_MISSING` (409) se essa versão específica não existir mais. 7 testes e2e novos, incluindo isolamento entre tenants e a diferença de permissão entre `operator` e `admin`.

Nota sobre o `pnpm run test:int` completo: rodando o monorepo inteiro de uma vez, alguns arquivos falharam por esgotamento de recursos do Docker Desktop (3.8 GB / 2 CPUs alocados nesta máquina, dividido com outros contêineres do usuário) — não por regressão. Confirmado rodando os 13 arquivos de integração em lotes pequenos: todos passam, 70/70.

---

### T12: Gate de ativação (função pura)

**What:** `ActivationGate.evaluate(instance, bindings, catalog)` devolvendo `ok` ou a lista de impedimentos com código.
**Where:** `packages/core/src/activation-gate.ts`
**Depends on:** T2
**Reuses:** —
**Requirement:** BIND-03, BIND-04, BIND-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Sem I/O algum — testável sem banco e sem NestJS
- [x] Matriz coberta: obrigatória faltando, opcional faltando, config inválida, conexão revogada, versão ausente, caminho feliz
- [x] Cada impedimento carrega código e os dados para a mensagem (quais capabilities, quais campos)

**Feito em 06/09/2026.** `evaluateActivation()` em `packages/core/src/activation-gate.ts` — recebe dados já resolvidos (não tipos de `catalog`/`db`), justamente para não criar dependência circular (`catalog → core`, nunca o inverso). `AGENT_VERSION_MISSING` é o único impedimento que encerra a avaliação sozinho: sem a definição do agente não há capability exigida nem schema pra validar. Os outros três impedimentos acumulam — uma instância pode estar com config inválida E capability sem vínculo E conexão revogada ao mesmo tempo, e o teste prova os três juntos numa avaliação só. 8 testes, zero I/O.

---

### T13: Vínculo de capability

**What:** `PUT`/`DELETE` de binding, aceitando apenas conexão cujo conector satisfaça a capability, e substituindo o vínculo existente.
**Where:** `apps/api/src/service-instances/bindings.*`
**Depends on:** T11
**Reuses:** catálogo para conferir a capability do conector
**Requirement:** BIND-01, BIND-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Conexão de conector incompatível é recusada nomeando a incompatibilidade
- [x] Conexão de outro tenant responde 404, indistinguível de inexistente
- [x] Vincular capability já vinculada substitui, sem criar segunda linha

**Feito em 06/09/2026.** `PUT/DELETE /service-instances/:id/bindings/:capability`. A indistinguibilidade entre "conexão inexistente" e "conexão de outro tenant" vem de graça da RLS — `findConnectorConnectionById` sob `withTenant` já devolve `undefined` nos dois casos, sem checagem extra no código. Seguido o padrão do projeto: `DomainError` nunca ecoa detalhe dinâmico na mensagem de interface (por isso `CAPABILITY_MISMATCH` tem mensagem genérica, não "conector X entrega Y"). 6 testes e2e novos.

---

### T14: Ativar e pausar

**What:** endpoints de ativação e pausa consumindo o gate, com os impedimentos na resposta.
**Where:** `apps/api/src/service-instances/lifecycle.*`
**Depends on:** T12, T13
**Reuses:** T12
**Requirement:** BIND-03 a BIND-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Ativação recusada devolve 409 com a lista de impedimentos codificada
- [x] Ativa com capabilities opcionais vazias
- [x] Pausar preserva config e vínculos, e reativar volta a passar pelo gate

**Feito em 06/09/2026.** `POST /service-instances/:id/{activate,pause}`. `evaluateInstanceActivation` é a ponte entre dados reais (catálogo, config, bindings, status da conexão) e o gate puro da T12 — nunca cacheia um resultado "já passou uma vez": cada chamada de `activate` reconstrói a entrada do zero e reavalia. `ErrorFilter` ganhou o mesmo tratamento de `fields` para `impediments`. Fecha a US4 (Ligar as conexões e travar ativação incompleta) — pode ir pra Revisão na Asana. A US2 (Instalar e configurar) ainda não fecha: o backend está pronto desde a T11, mas ela depende também do painel (T19-T21), que é fase separada do plano. 5 testes e2e novos, incluindo o cenário mais importante: desvincular uma capability obrigatória depois de pausar bloqueia a reativação, provando que o gate roda de novo a cada chamada.

---

### T15: Autorização por papel nas rotas do M1

**What:** `owner`/`admin` escrevem; `operator` só lê, em instâncias e conexões.
**Where:** `apps/api/src/auth/roles.guard.ts`, decorators nas rotas
**Depends on:** T10
**Reuses:** papéis e guard do M0
**Requirement:** Edge case de autorização da spec

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `operator` recebe 403 ao criar conexão ou ativar instância, e 200 ao listar
- [x] O 403 de autorização continua distinto do 401 de autenticação

**Feito em 06/09/2026.** Auditoria confirmou que os decorators (`@RequireRole("admin")` nas rotas de escrita, `@Protected()` nas de leitura) já estavam corretos desde T11/T13/T14 — nenhum código de produção mudou. Faltava só cobertura de teste: adicionado um e2e de operator em `bindings.controller.e2e.test.ts` (bind/unbind → 403) e outro em `lifecycle.controller.e2e.test.ts` (activate/pause → 403), confirmando 403 distinto de 401 e que nenhuma tentativa do operator surte efeito.

---

### T16: Serviço de conexões — criar e listar

**What:** separação entre campos secretos e metadados, cifragem pelo cofre e persistência em uma transação; e a listagem com DTO que não possui campo de segredo.
**Where:** `apps/api/src/connections/`
**Depends on:** T7, T10
**Reuses:** cofre (T6), `auth_schema` do catálogo
**Requirement:** SEC-01, SEC-03, SEC-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] O tipo do DTO de resposta não tem campo de segredo — ausência no tipo, não omissão em runtime
- [x] Metadados não secretos ficam legíveis em `metadata`; só os marcados vão ao cofre
- [x] Falha após a cifragem não deixa conexão parcialmente gravada
- [x] Nome duplicado no mesmo conector é recusado antes de qualquer cifragem

**Feito em 06/09/2026.** `POST/GET /connections`. Usa `connector.secretFields`/`metadataFields` (já existiam em `defineConnector`) para separar o que vai cifrado do que fica em `metadata` — os campos secretos viram um JSON cifrado de uma vez só (`vault.seal`), e o `last4` vem do primeiro campo secreto declarado no conector. Duplicidade de nome é checada com uma consulta antes de chamar o cofre (`findConnectorConnectionByName`, nova no repositório), então nunca cifra à toa. O `Vault` passou a nascer uma única vez em `AppModule.register`, via um provider Nest (`token VAULT`, `apps/api/src/connections/connections.constants.ts`) que embrulha o `createVault(kekSet)` já carregado no boot — é o primeiro lugar do M1 em que o cofre entra em código HTTP, e não só no CLI de rotação.

---

### T17: Substituir credencial e revogar

**What:** `PATCH` substituindo o segredo com os vínculos preservados, e `revoke` que pausa, na mesma transação, as instâncias que perderam capability obrigatória.
**Where:** `apps/api/src/connections/revoke.*`
**Depends on:** T16
**Reuses:** gate (T12) para decidir quais instâncias perdem obrigatória
**Requirement:** ROT-01, ROT-02, ROT-03, SEC-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Revogação nunca é bloqueada por dependência
- [ ] Instância que perdeu obrigatória fica `paused` com `status_reason` preenchido; a que perdeu opcional segue ativa
- [ ] Substituir credencial mantém os vínculos existentes
- [ ] Nenhuma rota oferece caminho para ler o segredo

---

### T18: Verificação de conexão

**What:** `POST /connections/:id/check` gravando `unverified` e a data, atrás da interface que o M3 vai implementar de verdade.
**Where:** `apps/api/src/connections/check.*`
**Depends on:** T17
**Reuses:** —
**Requirement:** CHK-01, CHK-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Responde `unverified` distinguindo-o de falha de credencial
- [ ] Data da última verificação é registrada e devolvida na listagem
- [ ] A interface é a mesma que um adapter real preencherá, sem mudança de rota nem de DTO

---

### T19: Painel — cliente de API e tela de catálogo

**What:** tipos compartilhados em `contracts`, cliente de API das rotas do M1, e a tela de catálogo com cards de agentes e ação de instalar.
**Where:** `apps/web/src/routes/catalog/`, `apps/web/src/api/`, `packages/contracts/`
**Depends on:** T4
**Reuses:** shell autenticado e interceptor de 401 do M0
**Requirement:** CAT-01, INST-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Cards mostram capabilities exigidas, distinguindo obrigatória de opcional
- [ ] Instalar leva à instância recém-criada
- [ ] Nenhum componente conhece um agente específico

---

### T20: Painel — renderizador de formulário por schema

**What:** componente que monta o formulário a partir do JSON Schema, cobrindo o subconjunto documentado, com validação e erros por campo.
**Where:** `apps/web/src/schema-form/`
**Depends on:** T19
**Reuses:** JSON Schema derivado em T2
**Requirement:** INST-03

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Todos os construtos do subconjunto renderizam, com teste por tipo de campo
- [ ] Campo marcado como secreto renderiza mascarado e nunca recebe valor do servidor
- [ ] Erros do servidor (422) aparecem ao lado dos campos correspondentes

---

### T21: Painel — tela da instância

**What:** abas de Configuração e Conexões, ações de ativar e pausar, e os impedimentos do gate exibidos como lista do que falta.
**Where:** `apps/web/src/routes/service-instances/`
**Depends on:** T14, T20
**Reuses:** T20
**Requirement:** INST-02 a INST-06, BIND-01 a BIND-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Cada capability aparece com seu vínculo atual e a marcação de obrigatória
- [ ] Recusa de ativação vira lista nomeada, com link para a aba onde se resolve
- [ ] Configuração salva sobrevive a recarregar a página

---

### T22: Painel — tela de conexões

**What:** listagem com fornecedor, `last4`, estado e última verificação; criar, substituir credencial e revogar.
**Where:** `apps/web/src/routes/connections/`
**Depends on:** T18, T20
**Reuses:** T20 (o formulário sai do `auth_schema`)
**Requirement:** SEC-03, SEC-04, ROT-01, CHK-03

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Não existe elemento de interface que exiba ou solicite a leitura de um segredo
- [ ] Revogar avisa quantos serviços foram pausados
- [ ] Conexão nunca verificada é distinguível de verificada com falha

---

### T23: Gate — teste de contenção de segredo

**What:** o teste que carrega o milestone: semeia um sentinela, exercita o fluxo inteiro, e varre respostas HTTP, log e todas as colunas de texto e jsonb do banco.
**Where:** `apps/api/test/secret-containment.e2e.ts`
**Depends on:** T18, T21, T22
**Reuses:** infraestrutura de Testcontainers do M0
**Requirement:** SEC-01, SEC-03, SEC-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Varre por valor, não por nome de campo — um DTO novo com nome inocente é pego
- [ ] Cobre cadastro, listagem, vínculo, ativação, revogação e erro de validação
- [ ] Falha de propósito quando um endpoint é adulterado para vazar, provando que o teste morde

---

### T24: Gate — isolamento e criptografia de ponta a ponta

**What:** isolamento cruzado de conexões entre dois tenants, e o conjunto de criptografia (ida e volta, tenants distintos, AAD, rotação v1→v2).
**Where:** `packages/core/test/vault.int.ts`, `apps/api/test/tenant-isolation-m1.int.ts`
**Depends on:** T18
**Reuses:** teste de introspecção do M0
**Requirement:** SEC-02, SEC-07, ROT-04, ROT-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] As três tabelas novas aparecem cobertas pelo teste de introspecção sem edição dele
- [ ] Rotação executada de ponta a ponta com conexões nas duas versões legíveis
- [ ] Envelope movido entre tenants no banco não decifra

---

### T25: Fechamento do milestone

**What:** e2e do fluxo completo (instalar → configurar → conectar → ativar), atualização de ROADMAP e STATE, e o procedimento de custódia da KEK no README do operador.
**Where:** `apps/web/test/`, `.specs/project/{ROADMAP.md,STATE.md}`, `README.md`
**Depends on:** T23, T24
**Reuses:** —
**Requirement:** todos os Success Criteria da spec

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Um percurso e2e vai do catálogo até a instância ativa
- [ ] `pnpm check` verde
- [ ] ROADMAP marca o M1 concluído; STATE registra decisões, lições e riscos do milestone
- [ ] Procedimento de custódia e rotação da KEK documentado para o operador
