# Roadmap

**Current Milestone:** M2 — Runtime de execução
**Status:** Especificado — spec em `.specs/features/execution-runtime/`; M1 concluído em 2026-09-06

---

## M0 — Fundação ✅ Concluído em 2026-09-06

**Goal:** Existe um sistema multitenant que sobe, autentica e isola dados no banco. Nada plugável ainda, mas a base de segurança está provada.
**Target:** Login funcional, painel vazio, e teste de isolamento verde.

### Features

**Ambiente de desenvolvimento** — DONE

- Monorepo pnpm com workspaces (`api`, `web`, pacotes compartilhados)
- Docker Compose subindo Postgres, Redis, api e web
- Pipeline local de lint, typecheck e testes

**Persistência multitenant** — DONE

- Migrações versionadas
- Convenção de `tenant_id` e policies de RLS
- Estabelecimento de contexto de tenant por transação (`SET LOCAL`)
- Teste de isolamento como gate de segurança

**Identidade e acesso** — DONE

- `Tenant`, `User`, `Membership` com papéis (`owner`, `admin`, `operator`)
- Autenticação e sessão
- Painel React com shell autenticado

---

## M1 — Núcleo plugável ✅ Concluído em 2026-09-06

**Spec:** `.specs/features/pluggable-core/`
**Goal:** Um tenant consegue instalar, configurar e conectar um serviço pelo painel — sem executá-lo ainda.

### Features

**Catálogo** — DONE

- `AgentDefinition` e `ConnectorDefinition` carregados do código
- Capabilities como contrato entre agente e conector
- Listagem do catálogo no painel, com formulário de instalação gerado a partir do `config_schema`

**Service instances** — DONE

- Ciclo de vida: instalar, ativar, pausar, remover (remoção lógica)
- Config por instância validada contra `config_schema` da versão fixada, editável na tela da instância
- Gate de ativação nomeando cada impedimento (config inválida, capability obrigatória sem vínculo, conexão revogada, versão de agente ausente)

**Conexões de conector (cofre de segredos)** — DONE

- Envelope encryption conforme ADR-001: DEK por conexão derivada por tenant (HKDF), KEK via Docker secret (diretório versionado), AES-256-GCM com AAD amarrando tenant/conexão/versão
- `ConnectorConnection` por tenant; API write-only (nenhum endpoint retorna segredo, nem o painel exibe ou relê um)
- Credencial por formulário a partir do `auth_schema`; o fluxo OAuth foi adiado para o M3, junto do primeiro adapter que consome o token (o modelo de dados já nasce preparado)
- `ConnectorBinding` preenchendo as capabilities exigidas pelo agente, com tela própria de vínculo por capability
- Bloqueio de ativação enquanto houver capability obrigatória não preenchida
- Revogação (pausa em cascata as instâncias que perdem capability obrigatória) e substituição de credencial sem recriar bindings
- Rotação de KEK por CLI (`kek:rotate`), resumível e idempotente
- Teste de contenção de segredo — sentinela varrido por valor em respostas HTTP, log e todas as colunas de texto/jsonb do banco
- Verificação de conexão declarada, respondendo `unverified` até existir adapter (M3)

**Painel** — DONE

- Tela de catálogo, tela da instância (abas Configuração/Conexões) e tela de conexões
- Renderizador de formulário genérico a partir de JSON Schema, com campo secreto sempre mascarado e nunca populado com valor do servidor

---

## M2 — Runtime de execução ◄ atual

**Spec:** `.specs/features/execution-runtime/`
**Goal:** Um agente roda de verdade: agendado, observável, e capaz de parar para pedir aprovação humana.

### Features

**Motor de execução** — SPECIFIED

- Fila BullMQ e worker consumindo jobs
- Execução de grafo LangGraph com checkpointer em Postgres
- `ServiceRun` e `RunStep` como trilha de auditoria

**Aprovação humana** — SPECIFIED

- Interrupt do grafo emitindo `ApprovalRequest`
- Run em `awaiting_approval` e retomada a partir do checkpoint
- Fila de aprovações no painel
- Aprovação vale só para aquela rodada; gate reavaliado na retomada

**Plano de entrega** — SPECIFIED

- Entrega como primitiva do runtime, não lógica de agente (D40)
- Lista de itens `{destinatário, capability, mensagem, anexos, chave de idempotência}` — é o payload do `ApprovalRequest`
- Entrega item a item: falha de um não derruba os outros; rodar de novo não reenvia o que já foi
- Resultado por item como `RunStep`

**Leitura estruturada de documento** — SPECIFIED

- Extração de texto local; visão como exceção para PDF sem camada de texto (D43)
- Saída estruturada validada por schema: tipo, CNPJ, nome, vencimento, competência (D42)
- Triagem por conteúdo, aposentando o prefixo de nome de arquivo
- Conteúdo de documento é dado, nunca comando (prompt injection)

**Gateway de LLM** — SPECIFIED

- Chamadas via OpenRouter com modelo configurável por agente
- Contabilidade de tokens e custo por passo

**Agendamento** — SPECIFIED

- `Schedule` por instância com cron e timezone
- Processo `scheduler` enfileirando execuções
- Uma execução por janela; janelas perdidas não disparam em rajada

**Observabilidade** — SPECIFIED

- Histórico de execuções por instância, com detalhe por passo e por item entregue
- Custo da execução visível
- Streaming de log ao vivo ficou fora do M2 (conforto, não requisito)

---

## M3 — Conectores reais

**Goal:** As integrações que a rotina contábil exige existem e são testadas contra contrato.

### Features

**Entrada de arquivos (capability `file-storage`)** — PLANNED

- `platform-upload` — storage da própria plataforma; é o adapter de menor risco, então vem primeiro e destrava o M4
- `onedrive` — Microsoft Graph API (caminho preferido do tenant piloto)
- `google-drive` — via adapter MCP; valida também o caminho genérico de MCP

**Conector de email (`gmail`)** — PLANNED

- Serve tanto para notificação quanto como via de entrega de documentos

**Conector de mensageria (`whatsapp` via adapter MCP)** — PLANNED

- Capability opcional: o serviço ativa sem ele

**Conector de entrega de documentos (`fortes-conecta` via API REST)** — PLANNED

- API oficial com API key; sem automação de browser

---

## M4 — Agente contábil (MVP)

**Goal:** O tenant piloto opera pela plataforma. A skill avulsa é aposentada.

### Features

**Regras de negócio contábeis** — PLANNED

- Resolução dos documentos exigidos por categoria de cliente
- Validação de conteúdo (competência, CNPJ) como função pura
- Idempotência de envio (`send_receipts`)

**Grafo `accounting-routine`** — PLANNED

- Conferência de folha e conferência fiscal x DAS
- Preparo de envio com gate de aprovação antes de qualquer efeito externo
- Envio multicanal por capability

**Migração de dados** — PLANNED

- `clientes.yaml` para a collection `customers`
- Schedules dos dias 01, 02, 05, 07 e 10

---

## Future Considerations

- Chat com agentes (spec próprio)
- Billing e limites de gasto por tenant, sobre a contabilidade já coletada
- Segundo tenant real e onboarding self-service
- Catálogo de conectores MCP dirigido por manifesto, sem deploy
- Banco dedicado por tenant para planos com exigência de isolamento físico
