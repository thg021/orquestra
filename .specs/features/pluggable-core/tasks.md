# M1 — Núcleo plugável: Tasks

**Design:** `.specs/features/pluggable-core/design.md`
**Spec:** `.specs/features/pluggable-core/spec.md`
**Testing:** `.specs/codebase/TESTING.md`
**Status:** Pendente — 0 de 25 tasks

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
**Where:** `packages/catalog/src/{index.ts,types.ts,define.ts,secret.ts}`, `pnpm-workspace.yaml`
**Depends on:** —
**Reuses:** regra de dependência do M0 (`catalog → core`, nunca NestJS)
**Requirement:** CAT-01, CAT-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] `defineAgent` e `defineConnector` recusam, em tempo de chamada, definição sem chave, sem versão em semver ou sem capability
- [ ] `secret()` anota o campo sem alterar o tipo inferido pelo Zod
- [ ] Teste de fronteira confirma que o pacote não importa NestJS nem `packages/db`

---

### T2: Validação do catálogo e derivação de JSON Schema

**What:** `validateCatalog()` reprovando chave duplicada, versão fora de semver, capability órfã e schema fora do subconjunto do formulário; e a conversão Zod → JSON Schema que o painel consome.
**Where:** `packages/catalog/src/{validate.ts,json-schema.ts}`
**Depends on:** T1
**Reuses:** `zod-to-json-schema`
**Requirement:** CAT-03, CAT-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Cada uma das quatro classes de problema tem teste próprio e é reportada nomeando o culpado
- [ ] O subconjunto suportado do design (texto, enum, número, booleano, lista de texto, objeto de um nível) converte; qualquer outro construto é reprovado
- [ ] Campos marcados com `secret()` chegam anotados no JSON Schema

---

### T3: Definições reais do catálogo

**What:** o `AgentDefinition` de `accounting-routine` (config, capabilities obrigatórias e opcionais, `data_collections`, sem grafo) e os seis `ConnectorDefinition`: `platform-upload`, `onedrive`, `google-drive`, `gmail`, `whatsapp`, `fortes-conecta`.
**Where:** `packages/catalog/src/agents/accounting-routine.ts`, `packages/catalog/src/connectors/*.ts`
**Depends on:** T2
**Reuses:** skill `rotina-contabil` como fonte da configuração que o agente precisa
**Requirement:** CAT-01, CAT-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] `validateCatalog()` passa com as definições reais carregadas
- [ ] Toda capability exigida pelo agente é satisfeita por ao menos um conector
- [ ] Campos de credencial de cada conector estão marcados com `secret()`; `baseUrl` e afins não

---

### T4: Endpoints de catálogo e validação no boot

**What:** `CatalogController` servindo `GET /catalog/agents` e `/catalog/connectors`, e a chamada de `validateCatalog()` na inicialização, derrubando o processo com a lista de problemas.
**Where:** `apps/api/src/catalog/`, `apps/api/src/main.ts`
**Depends on:** T3
**Reuses:** padrão de boot do M0 (`loadConfig` → migrações → escuta)
**Requirement:** CAT-01, CAT-02, CAT-03, CAT-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] As duas rotas devolvem o catálogo com JSON Schema embutido
- [ ] Catálogo inválido encerra o processo com código diferente de zero, listando todos os problemas
- [ ] Nenhuma consulta a banco participa da resposta do catálogo
- [ ] `@Inject(Token)` explícito em todo construtor (convenção do M0 em `TESTING.md`)

---

### T5: Carregamento da KEK

**What:** leitura da KEK do arquivo apontado por `KEK_FILE`, com suporte a múltiplas versões ativas, e falha de inicialização quando ausente ou malformada.
**Where:** `packages/core/src/vault/kek.ts`, `apps/api/src/config/`, `.env.example`, `docker/compose.yml`
**Depends on:** —
**Reuses:** `loadConfig` do M0
**Requirement:** SEC-02, ROT-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] KEK montada como Docker secret em arquivo, nunca como variável de ambiente
- [ ] Ausência, permissão negada ou tamanho inválido encerram o processo nomeando o problema, sem imprimir conteúdo
- [ ] Mais de uma versão de KEK pode coexistir, indexada por número de versão

---

### T6: Cofre — `seal` e `open`

**What:** derivação da chave de tenant por HKDF, geração de DEK, cifragem AES-256-GCM com AAD, e o formato de envelope binário do design.
**Where:** `packages/core/src/vault/{seal.ts,envelope.ts,index.ts}`
**Depends on:** T5
**Reuses:** `node:crypto` — sem dependência nova
**Requirement:** SEC-01, SEC-02, SEC-06, SEC-07

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] `open(seal(x)) === x` para segredos de tamanhos variados, incluindo unicode
- [ ] O mesmo plaintext em dois tenants produz envelopes diferentes
- [ ] Envelope de um tenant não abre sob outro tenant nem sob outro `connection_id` (o AAD falha)
- [ ] Nenhuma mensagem de erro do módulo contém plaintext, chave ou envelope — com teste que verifica

---

### T7: Cofre — recifragem de DEK

**What:** `rewrapDek` abrindo a DEK sob uma versão de KEK e recifrando sob outra, sem tocar o `secret_envelope`.
**Where:** `packages/core/src/vault/rewrap.ts`
**Depends on:** T6
**Reuses:** T6
**Requirement:** ROT-04, ROT-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Após recifrar, `open` continua devolvendo o mesmo plaintext
- [ ] O `secret_envelope` é byte a byte idêntico ao anterior
- [ ] Conexões em v1 e em v2 convivem legíveis no mesmo conjunto

---

### T8: Comando `kek:rotate`

**What:** comando de operador que percorre as conexões abaixo da versão alvo e recifra suas DEKs, idempotente e retomável.
**Where:** `apps/api/src/cli/kek-rotate.ts`
**Depends on:** T7, T10
**Reuses:** CLI do operador do M0
**Requirement:** ROT-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Interromper no meio deixa as duas versões convivendo, ambas legíveis
- [ ] Rodar de novo conclui o trabalho e é inofensivo quando não há mais o que fazer
- [ ] Nenhum plaintext de segredo é decifrado durante a rotação

---

### T9: Migração das tabelas do M1 com RLS

**What:** schema Drizzle e migração SQL de `service_instances`, `connector_connections` e `connector_bindings`, com `enable`+`force` RLS, policies, índices e restrições únicas do design.
**Where:** `packages/db/src/schema/*.ts`, `packages/db/migrations/`
**Depends on:** T1, T6
**Reuses:** padrão de policy do M0, com `nullif(current_setting(...), '')::uuid`
**Requirement:** SEC-07, INST-01, BIND-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] O teste de introspecção de RLS do M0 passa a cobrir as três tabelas sem alteração no próprio teste
- [ ] Segredo e DEK são `bytea`; `key_version` é coluna própria e consultável
- [ ] Única por `(service_instance_id, capability)` impede dois vínculos na mesma capability

---

### T10: Repositórios sob contexto de tenant

**What:** repositórios de instâncias, conexões e bindings, todos passando por `withTenant`, sem nenhum caminho alternativo ao pool.
**Where:** `packages/db/src/repositories/*.ts`
**Depends on:** T9
**Reuses:** `withTenant` do M0
**Requirement:** INST-01 a INST-06, SEC-01, BIND-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Teste de integração confirma leitura cruzada vazia entre dois tenants nas três tabelas
- [ ] Regra de lint continua impedindo importar o pool fora de `packages/db`
- [ ] Listagem padrão de instâncias omite as removidas

---

### T11: Serviço de instâncias — instalar, configurar, remover

**What:** `install`, `update` (nome e config, validada contra o schema da versão fixada) e `remove` lógico.
**Where:** `apps/api/src/service-instances/`
**Depends on:** T10
**Reuses:** catálogo (T2) para validar config
**Requirement:** INST-01, INST-02, INST-04, INST-05, INST-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Config inválida devolve 422 com os campos e motivos, sem gravar
- [ ] A validação usa a versão fixada na instância, não a mais recente do catálogo
- [ ] Remoção preserva a linha e os vínculos, e some da listagem

---

### T12: Gate de ativação (função pura)

**What:** `ActivationGate.evaluate(instance, bindings, catalog)` devolvendo `ok` ou a lista de impedimentos com código.
**Where:** `packages/core/src/activation-gate.ts`
**Depends on:** T2
**Reuses:** —
**Requirement:** BIND-03, BIND-04, BIND-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Sem I/O algum — testável sem banco e sem NestJS
- [ ] Matriz coberta: obrigatória faltando, opcional faltando, config inválida, conexão revogada, versão ausente, caminho feliz
- [ ] Cada impedimento carrega código e os dados para a mensagem (quais capabilities, quais campos)

---

### T13: Vínculo de capability

**What:** `PUT`/`DELETE` de binding, aceitando apenas conexão cujo conector satisfaça a capability, e substituindo o vínculo existente.
**Where:** `apps/api/src/service-instances/bindings.*`
**Depends on:** T11
**Reuses:** catálogo para conferir a capability do conector
**Requirement:** BIND-01, BIND-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Conexão de conector incompatível é recusada nomeando a incompatibilidade
- [ ] Conexão de outro tenant responde 404, indistinguível de inexistente
- [ ] Vincular capability já vinculada substitui, sem criar segunda linha

---

### T14: Ativar e pausar

**What:** endpoints de ativação e pausa consumindo o gate, com os impedimentos na resposta.
**Where:** `apps/api/src/service-instances/lifecycle.*`
**Depends on:** T12, T13
**Reuses:** T12
**Requirement:** BIND-03 a BIND-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Ativação recusada devolve 409 com a lista de impedimentos codificada
- [ ] Ativa com capabilities opcionais vazias
- [ ] Pausar preserva config e vínculos, e reativar volta a passar pelo gate

---

### T15: Autorização por papel nas rotas do M1

**What:** `owner`/`admin` escrevem; `operator` só lê, em instâncias e conexões.
**Where:** `apps/api/src/auth/roles.guard.ts`, decorators nas rotas
**Depends on:** T10
**Reuses:** papéis e guard do M0
**Requirement:** Edge case de autorização da spec

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] `operator` recebe 403 ao criar conexão ou ativar instância, e 200 ao listar
- [ ] O 403 de autorização continua distinto do 401 de autenticação

---

### T16: Serviço de conexões — criar e listar

**What:** separação entre campos secretos e metadados, cifragem pelo cofre e persistência em uma transação; e a listagem com DTO que não possui campo de segredo.
**Where:** `apps/api/src/connections/`
**Depends on:** T7, T10
**Reuses:** cofre (T6), `auth_schema` do catálogo
**Requirement:** SEC-01, SEC-03, SEC-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] O tipo do DTO de resposta não tem campo de segredo — ausência no tipo, não omissão em runtime
- [ ] Metadados não secretos ficam legíveis em `metadata`; só os marcados vão ao cofre
- [ ] Falha após a cifragem não deixa conexão parcialmente gravada
- [ ] Nome duplicado no mesmo conector é recusado antes de qualquer cifragem

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
