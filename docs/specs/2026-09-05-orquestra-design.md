# Plataforma multitenant de automação com agentes — Design

**Data:** 2026-09-05
**Status:** aprovado para planejamento de implementação

## 1. Contexto e objetivo

Hoje existe uma automação single-tenant: a skill `rotina-contabil`, um documento markdown interpretado por um agente, que orquestra a rotina mensal de um escritório contábil (conferência de folha, conferência fiscal x DAS, envio de documentos a clientes por Gmail/WhatsApp/Fortes Conecta), lendo arquivos de uma pasta local sincronizada do OneDrive e mantendo estado em `clientes.yaml`, marcadores `_controle/*.enviado` e `log.jsonl`.

O objetivo é construir uma **plataforma horizontal, multitenant, de automação com agentes**, onde a rotina contábil é o primeiro caso de uso, não o produto. Qualquer domínio de negócio deve poder plugar seus próprios fluxos e integrações.

A unidade de valor da plataforma é o **service instance**: a combinação de um agente (o quê fazer) com conectores (com o quê integrar), instalada num tenant e gerenciada como um sistema próprio dentro dele — com ciclo de vida, configuração, dados e observabilidade próprios.

### Critério de sucesso do MVP

Um tenant real (o escritório do autor) rodando a rotina contábil **através da plataforma**, agendada, com aprovação humana pelo painel — não mais através da skill avulsa.

## 2. Escopo

### Dentro

- Multitenancy com isolamento de dados garantido no banco.
- Catálogo de agentes e catálogo de conectores, combináveis independentemente.
- Ciclo de vida de service instances (instalar / ativar / pausar / remover).
- Configuração por service instance, dirigida por schema.
- Credenciais de conector autenticadas uma vez por tenant e reutilizáveis entre serviços.
- Execução assíncrona de grafos de agente, agendada ou sob demanda.
- Aprovação humana como primitiva do runtime.
- Observabilidade por execução, com contabilidade de custo de LLM.
- Painel React de administração e observabilidade.
- O agente `accounting-routine`, migrando a skill `rotina-contabil`.

### Fora (deliberadamente)

- **Chat com agentes** — superfície de interação com desenho próprio; fase pós-MVP, com spec separado.
- **Billing e planos** — a contabilidade de custo por tenant é coletada desde o MVP, mas não há cobrança.
- **Marketplace de terceiros** — todo agente e conector é código do operador da plataforma. Não há execução de código de terceiros, portanto não há necessidade de sandboxing no MVP.
- **Kubernetes** — o alvo é Docker Compose em host único.
- **Segundo tenant real** — a arquitetura suporta, mas provar com um tenant é suficiente para validar o modelo.

## 3. Decisões arquiteturais

### D1 — Service instance como unidade central

O modelo gira em torno de `ServiceInstance` (tenant + definição de agente + bindings de conector + config + status), em vez de tratar agentes como capabilities soltas do tenant.

**Por quê:** o requisito é que cada serviço plugado se comporte como um sistema próprio dentro do tenant — ciclo de vida, config/secrets, dados e logs isolados. Com service instance como entidade de primeira classe, isso é estrutural: instalar/pausar é mudar um status, e dados e execuções já nascem particionados por instância. Isso também isola dois serviços do *mesmo* tenant entre si, o que um modelo centrado no tenant não faz sem retrabalho.

**Custo aceito:** uma camada de indireção a mais (`AgentDefinition` → `ServiceInstance` → `ConnectorBinding` → `ConnectorConnection`).

### D2 — Postgres compartilhado com `tenant_id` e Row-Level Security

Um banco, todas as tabelas de dados de tenant com coluna `tenant_id`, RLS ativada com policy baseada num setting de sessão.

**Por quê:** menor custo operacional e migração única, adequado ao estágio. A RLS é o ponto importante: o isolamento não depende de o desenvolvedor lembrar de escrever `WHERE tenant_id = ...` em toda query — um esquecimento vira zero linhas, não vazamento.

**Custo aceito:** isolamento lógico, não físico. Se um plano enterprise exigir banco dedicado no futuro, a migração é possível porque o `tenant_id` já é explícito em todo lugar.

### D3 — Monólito modular em papéis de processo

Uma única base de código e imagem Docker, com módulos por bounded context, executada em três papéis (`api`, `worker`, `scheduler`).

**Por quê:** um deploy, um conjunto de migrações, refatoração de fronteiras barata enquanto o domínio ainda está sendo descoberto. A separação em serviços independentes é reversível a partir daqui; o inverso não é.

### D4 — Conectores como Anti-Corruption Layer (ports e adapters)

O código do agente depende de *ports* definidos por capability (`EmailPort`, `MessagingPort`, `FileStoragePort`, `DocumentDeliveryPort`), nunca de um SDK de fornecedor.

**Por quê:** independência de fornecedor é o que torna o catálogo realmente plugável. Trocar Gmail por Outlook, ou OneDrive por Google Drive, é escrever um adapter — o agente não muda e nem toma conhecimento.

### D5 — MCP como tipo de adapter de primeira classe

Um `ConnectorDefinition` pode ser **nativo** (TypeScript sobre um SDK/HTTP) ou **MCP** (declarativo: aponta um MCP server e mapeia tools para métodos do port).

**Por quê:** boa parte das integrações futuras vira configuração em vez de código. Ambas as formas expõem a mesma interface ao agente.

### D6 — Aprovação humana é primitiva de plataforma, não lógica de agente

Um grafo pode suspender a execução emitindo um `ApprovalRequest`; o run fica `awaiting_approval` e retoma do checkpoint quando decidido.

**Por quê:** na rotina contábil, o gate "monta o relatório → para → só envia depois de aprovação explícita" é a regra de segurança mais importante do sistema. Sendo primitiva do runtime, ela é uniforme, auditável e herdada de graça por qualquer agente futuro. LangGraph oferece interrupt e checkpoint nativos para isso.

### D7 — OpenRouter como gateway único de LLM

Toda chamada de modelo passa por um gateway interno que fala com OpenRouter, registrando tokens e custo no passo de execução.

**Por quê:** troca de modelo por agente sem mudança de código, e contabilidade de custo por tenant/serviço/execução desde o primeiro dia.

### D8 — Stack

TypeScript em todo lugar. NestJS para a API e os workers (módulos mapeiam bounded contexts; injeção de dependência serve bem o padrão ports/adapters), React no frontend, Postgres, Redis com BullMQ para filas, LangGraph para os grafos de agente, pnpm workspaces para o monorepo, Docker Compose para orquestração.

**Nota:** NestJS e BullMQ são escolhas de conveniência, revisáveis na Fase 0 sem impacto no restante do design. Postgres+RLS, ports/adapters e o modelo de domínio não são.

### Convenção

Todo identificador de código, nome de tabela, chave de configuração e nome de collection é em **inglês** (`customers`, não `clientes`). Textos voltados ao usuário final são em português.

## 4. Modelo de domínio

Seis bounded contexts:

| Contexto | Responsabilidade | Entidades |
|---|---|---|
| Identity & Access | quem é o tenant, quem são os usuários, o que podem fazer | `Tenant`, `User`, `Membership` |
| Catalog | o que existe para ser plugado (código do operador, não dado de tenant) | `AgentDefinition`, `ConnectorDefinition` |
| Service Management | o que cada tenant instalou e como está configurado | `ServiceInstance`, `ConnectorConnection`, `ConnectorBinding` |
| Scheduling | quando as automações disparam | `Schedule` |
| Execution | o que rodou, em que passo está, o que aguarda decisão | `ServiceRun`, `RunStep`, `ApprovalRequest` |
| Service Data | dados de negócio de cada serviço instalado | `ServiceRecord` |

### Entidades

**`Tenant`** — organização cliente da plataforma. Raiz de todo isolamento.

**`User` / `Membership`** — usuário e seu papel dentro de um tenant (`owner`, `admin`, `operator`). O papel `operator` é o mínimo necessário para decidir um `ApprovalRequest`.

**`AgentDefinition`** — código do operador, versionado, não pertence a tenant algum. Declara:
- `key` (ex: `accounting-routine`) e `version`
- `config_schema` — JSON Schema da configuração que o tenant preenche; gera o formulário no painel
- `required_capabilities` — ex: `["email", "messaging", "file-storage", "document-delivery"]`
- `data_collections` — coleções que o serviço mantém, com schema; geram CRUD básico no painel
- o grafo LangGraph que implementa o fluxo

**`ConnectorDefinition`** — código do operador. Declara `key` (`gmail`, `onedrive`, `whatsapp`, `fortes-conecta`), a `capability` que satisfaz, o `kind` (`native` ou `mcp`), e o schema de autenticação. A capability é o contrato que permite substituição de fornecedor.

**`ServiceInstance`** — a unidade instalada: `tenant_id`, `agent_definition_key`/`version`, nome dado pelo tenant, `config` (jsonb validado contra o `config_schema`), `status` (`installed` | `active` | `paused` | `removed`). Remoção é lógica, preservando histórico de execuções.

**`ConnectorConnection`** — uma credencial autenticada, pertencente ao **tenant** e reutilizável por vários serviços (o tenant autentica a conta Gmail do escritório uma vez só). Segredo cifrado em repouso.

**`ConnectorBinding`** — liga uma `ServiceInstance` a uma `ConnectorConnection`, preenchendo uma capability exigida pelo agente. Um serviço só pode ir para `active` com todas as capabilities exigidas preenchidas.

**`Schedule`** — `service_instance_id`, expressão cron, timezone, habilitado. Substitui o cron externo atual.

**`ServiceRun`** — uma execução: instância, gatilho (`scheduled` | `manual`), status (`queued` | `running` | `awaiting_approval` | `succeeded` | `failed` | `cancelled`), timestamps.

**`RunStep`** — um passo do grafo: nó, resumo de entrada/saída, tokens e custo quando houve chamada de LLM. É a trilha de auditoria que substitui o `log.jsonl`.

**`ApprovalRequest`** — payload apresentado ao humano, status (`pending` | `approved` | `rejected`), quem decidiu e quando. Vinculado a um `ServiceRun` suspenso.

**`ServiceRecord`** — namespace de dados por serviço: `service_instance_id + collection + key + data (jsonb)`. O `clientes.yaml` de hoje vira a collection `customers`. Isolado por instância, não apenas por tenant.

Toda tabela de dados de tenant carrega `tenant_id` e tem policy de RLS.

## 5. Runtime

### Topologia (Docker Compose, host único)

| Container | Papel |
|---|---|
| `web` | React: painel de administração e observabilidade |
| `api` | HTTP: auth, CRUD de instâncias/conexões, decisões de aprovação, streaming de logs |
| `worker` | consome a fila e executa os grafos |
| `scheduler` | lê `Schedule` e enfileira jobs nos horários devidos |
| `postgres` | dados de aplicação e checkpoints do LangGraph |
| `redis` | fila de jobs |

`api`, `worker` e `scheduler` são a mesma imagem em papéis diferentes.

### Fluxo de execução

1. Um gatilho (schedule ou ação manual no painel) cria um `ServiceRun` com status `queued` e enfileira um job contendo apenas `{ tenant_id, service_instance_id, run_id, trigger }` — ponteiros, nunca dados de negócio e nunca segredos.
2. O worker consome o job e **primeiro estabelece o contexto de tenant**: abre transação e executa `SET LOCAL app.tenant_id`. As policies de RLS leem esse setting. Como o setting é local à transação, o pooling de conexões não vaza contexto entre jobs.
3. Carrega a `ServiceInstance`, valida `config` contra o `config_schema`, resolve os `ConnectorBinding` e instancia os adapters correspondentes.
4. Monta e executa o grafo LangGraph do `AgentDefinition`, com checkpointer no Postgres.
5. Chamadas de LLM passam pelo gateway OpenRouter, que grava tokens e custo no `RunStep`.
6. Se o grafo emitir um `ApprovalRequest`, a execução interrompe com checkpoint salvo, o run vai para `awaiting_approval` e o painel notifica. Após decisão, o worker retoma do checkpoint — sem reexecutar o que já rodou.

### Isolamento e segredos

- RLS ativada em todas as tabelas de tenant; testada explicitamente (ver Estratégia de testes).
- **Segredos de conector seguem o [ADR-001](../adr/001-gestao-de-segredos-de-conectores.md)**: envelope encryption com DEK por conexão derivada por tenant, KEK fora do banco (Docker secret no MVP, KMS/Vault depois), AES-256-GCM com versionamento de chave para rotação incremental.
- **Write-only na API:** nenhum endpoint retorna um segredo. O painel exibe apenas metadados (últimos quatro caracteres, data de criação, status da última chamada); editar é substituir, nunca visualizar.
- **O LLM nunca alcança credenciais.** O modelo decide *o quê* fazer; o adapter detém o segredo e executa. Segredo não entra em prompt, payload de job, log, `RunStep` ou mensagem de erro — erros de autenticação do fornecedor são sanitizados antes de virar log. Esta é a defesa contra prompt injection: o agente lê conteúdo não confiável (e-mails, PDFs de cliente) e não pode ser induzido a exfiltrar o que não alcança.
- **Auditoria de uso sem o valor:** toda utilização de conexão registra qual conexão, qual execução e qual resultado, nunca o segredo. É o que sustenta revogação e resposta a incidente.
- OAuth é preferido a API key sempre que o fornecedor oferecer — escopo limitado, revogável do lado do fornecedor, e sem credencial digitada em formulário.

## 6. Contrato de extensão

O que se escreve para adicionar algo ao catálogo.

### Conector

**Adapter nativo** — TypeScript implementando um port. Usado quando há SDK específico ou lógica não trivial: Gmail API, Microsoft Graph, API REST do Fortes Conecta.

**Adapter MCP** — manifesto declarativo: aponta um MCP server, declara a capability satisfeita e mapeia tools do server para métodos do port. Adicionar Google Drive, Slack ou Notion tende a não exigir código novo.

Ambos expõem a mesma interface; o agente não consegue distinguir qual está do outro lado.

### Agente

Declara `config_schema`, `required_capabilities`, `data_collections` e o grafo. Os três primeiros são metadados que o painel consome para gerar a experiência de instalação e configuração sem formulário hardcoded por agente.

## 7. Migração da rotina contábil

O agente `accounting-routine` é uma **reescrita**, não um port: a skill é markdown interpretado por um agente; o serviço é código TypeScript executando um grafo determinístico, com LLM apenas nos nós que exigem julgamento. As regras de negócio saem do prompt e viram código testável.

| Hoje (skill) | Na plataforma |
|---|---|
| `clientes.yaml` | collection `customers` |
| subagentes read-only (`conferidor-folha`, `conferidor-fiscal-das`, `preparador-envio`) | nós do grafo, paralelizados por cliente |
| gate de aprovação antes do envio | `interrupt` → `ApprovalRequest` → painel |
| marcador `_controle/<mês>_<categoria>.enviado` | collection `send_receipts` (idempotência) |
| `log.jsonl` | `ServiceRun` + `RunStep` |
| cron dias 01/02/05/07/10 | `Schedule` da instância |
| Gmail MCP | adapter nativo `gmail` (capability `email`) |
| `whatsapp-mcp` | adapter MCP `whatsapp` (capability `messaging`) |
| Fortes Conecta via Playwright | adapter nativo `fortes-conecta` sobre a API REST oficial, com API key (capability `document-delivery`) |
| pasta local sincronizada do OneDrive | adapter nativo `onedrive` sobre Microsoft Graph (capability `file-storage`) |

Duas mudanças de substância em relação ao comportamento atual:

1. **Acesso a arquivos deixa de ser local.** A plataforma é hospedada e não tem acesso ao disco do escritório; os arquivos passam a ser lidos via Graph API. Isso precisa ser validado contra o tipo de conta Microsoft do tenant.
2. **Fortes Conecta deixa de ser automação de browser** e passa a usar a API oficial, o que remove o Playwright do sistema.

## 8. Estratégia de testes

- **Isolamento de tenant** — teste que prova que, com o contexto de tenant A ativo, linhas do tenant B são invisíveis em cada tabela com RLS. É o teste de segurança fundamental da plataforma.
- **Regras de negócio** — funções puras (resolução dos documentos exigidos por categoria, validação de competência e CNPJ no documento, idempotência de envio), testadas sem LLM e sem I/O.
- **Adapters** — testados contra contratos de port; cada port tem um fake usado pelos testes de agente.
- **Grafos** — executados com LLM fake e checkpointer em memória. O teste mais importante do sistema verifica que **nenhum efeito colateral externo ocorre antes da aprovação humana**: o grafo precisa interromper com o `ApprovalRequest` e nenhum adapter de envio pode ter sido chamado até então.
- **Contenção de segredo** — teste que executa um grafo com uma conexão de credencial conhecida e falha se aquele valor aparecer em qualquer prompt enviado ao LLM fake, payload de job, `RunStep`, log ou resposta da API. A regra do ADR-001 precisa ser sustentada por teste, não por revisão manual, porque cada adapter novo é uma chance de quebrá-la.

## 9. Fases de entrega

**Fase 0 — Fundação.** Monorepo, Docker Compose subindo, migrações, RLS ativada e testada, auth, `Tenant`/`User`/`Membership`. Entrega: login funcional com painel vazio.

**Fase 1 — Núcleo da plataforma.** Catálogo, ciclo de vida de `ServiceInstance`, `ConnectorConnection` cifrada, `ConnectorBinding`, UI de configuração dirigida por schema. Validado com um agente dummy e um conector fake. Entrega: instalar, configurar e listar um serviço, sem executá-lo.

**Fase 2 — Runtime.** Fila, worker, execução de grafo com checkpointer, `ServiceRun`/`RunStep`, gateway OpenRouter com custo, streaming de log, `Schedule`, e a primitiva de aprovação. Entrega: o agente dummy roda agendado, para numa aprovação e retoma após decisão.

**Fase 3 — Conectores reais.** `gmail`, `onedrive`, `whatsapp` (validando o caminho MCP genérico) e `fortes-conecta`. Cada um com teste de contrato.

**Fase 4 — Agente `accounting-routine`.** Regras de negócio como funções puras, o grafo com o gate de aprovação, collections `customers`/`documents`/`send_receipts`, schedules, e migração do `clientes.yaml` atual. **Fim desta fase é o MVP.**

**Pós-MVP.** Chat com agentes (spec próprio), billing, segundo tenant.

## 10. Riscos e questões em aberto

| Risco | Tratamento |
|---|---|
| A conta Microsoft do tenant piloto é pessoal (Outlook.com), o que já inviabilizou o conector M365 antes. A Graph API pessoal pode não atender ao acesso a arquivos necessário. | Validar cedo, na Fase 3, com uma prova de acesso real antes de construir o adapter completo. Se falhar, a alternativa é um agente-ponte local instalado no escritório, atrás do mesmo `FileStoragePort` — o design absorve a troca sem mudança no agente. |
| A API do Fortes Conecta pode não cobrir todo o fluxo de protocolo digital que a automação de browser cobria. | Validar a cobertura da API contra o fluxo atual antes de descartar o caminho alternativo. |
| Reescrever regras hoje implícitas em prompt pode perder comportamento que só existe na interpretação do agente. | A skill atual e seus `references/` são a especificação de origem; cada regra migrada vira teste antes de virar código. |
| Custo de LLM sem teto por tenant. | A contabilidade por `RunStep` existe desde a Fase 2; limites de gasto ficam para o billing pós-MVP, mas os dados para impô-los já estarão lá. |
