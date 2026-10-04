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

**Acréscimos do PRD do MVP** — SPECIFIED (T30 a T35, 2026-10-04)

- Status `delivering`, `completed`, `partial_failure`, `failed`, `nothing_to_do` (espera OQ-005)
- Plano aprovado imutável; plano mudou → nova aprovação (espera OQ-003)
- Retry automático até 3 vezes por item (D67) e nova tentativa manual só do que falhou
- Aviso guardado separado do status

---

> **Reorganizado em 2026-10-04** a partir do PRD do MVP (`docs/prd/PRD-Orquestra-MVP-v1.0.md`).
> Requisito por requisito: `.specs/project/PRD-MVP-GAP.md`. Decisões: D62 a D67.
> Os antigos M3 (Conectores) e M4 (Agente contábil) viraram M4 e M7.

```
  M2  Runtime de execução . . . .  atual
  M3  Carteira e automação  . . .  cliente, público, canal, seleção de documento
  M4  Conectores reais  . . . . .  arquivos, e-mail, WhatsApp, Fortes
  M5  Operações . . . . . . . . .  caixa operacional e auditoria
  M6  Acesso e equipe . . . . . .  convite, troca de escritório, senha
  M7  UC-001 no piloto  . . . . .  distribuição mensal rodando de verdade
```

A ordem segue o "walking skeleton" do PRD (§20): primeiro o caminho de uma rotina de ponta a ponta, depois a operação em volta, depois a entrada de mais gente. O piloto usa um escritório criado por CLI até o M6.

---

## M3 — Carteira e automação

**Goal:** O escritório cadastra seus clientes e configura uma rotina dizendo para quem ela roda, por qual canal e quais documentos ela procura.
**PRD:** CUS-001 a 006, AUT-002 a 012, SRV-008, EXE-002, EXE-003

### Features

**Carteira de clientes** — PLANNED (D63)

- `customers` próprio do tenant: CNPJ, estado `ACTIVE`/`INACTIVE`
- Vários contatos por cliente, com canal (vocabulário da D32)
- Grupos de clientes
- Modelo pronto para CPF, sem tela (CUS-005)
- Tela: Figma "Carteira de clientes — estados (v2)"

**Público da rotina** — PLANNED

- Audiência `ALL_ACTIVE` ou `SELECTED`
- `Enrollment` por cliente: `PENDING`, `READY`, `PAUSED`, `BLOCKED`
- Cliente `INACTIVE` não entra em execução nova

**Canal e provider por rotina** — PLANNED (D65)

- Default por capability na instância, override por cliente no `Enrollment`
- Depende da decisão C4 (uma ou várias conexões por conector)

**Seleção de documento** — PLANNED (D64)

- Regras por nome: `startsWith`, `contains`, `endsWith`, `equals` + extensão; sem regex
- Documentos esperados: ausência vira aviso (T35), não bloqueio
- Identidade do documento entre ciclos — espera OQ-002

**Prontidão e ciclo de vida** — PLANNED

- Gate de ativação do M1 passa a olhar também público e dados do cliente
- Estados `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED` (mapear sobre os de hoje)
- Tela: Figma "Configuração de automação — rascunho e prontidão (v2)"

**Execução por cliente** — PLANNED

- `CustomerRun` filho do `ServiceRun`: um por cliente elegível
- Falha de um cliente não para os outros
- Status do run agrega o dos clientes
- Delivery Package: um e-mail com vários anexos por cliente

---

## M4 — Conectores reais

**Goal:** As integrações que a rotina contábil exige existem e são testadas contra contrato.
**PRD:** SRV-006, SRV-007, OQ-004

### Features

**Capability declara efeito externo** — PLANNED

- Campo `sideEffect` na capability do catálogo (SRV-006)
- Pré-checagem (health) real por conector, no lugar do `unverified` do M1
- Tela: Figma "Serviço — conexão e pré-checagem (v2)"

**Entrada de arquivos (capability `file-storage`)** — PLANNED

- `platform-upload` — storage da própria plataforma; é o adapter de menor risco, então vem primeiro
- `onedrive` — Microsoft Graph API (caminho preferido do tenant piloto)
- `google-drive` — via adapter MCP; valida também o caminho genérico de MCP

**Conector de email (`gmail`)** — PLANNED

- Serve tanto para notificação quanto como via de entrega de documentos

**Conector de mensageria (`whatsapp` via adapter MCP)** — PLANNED

- Capability opcional: o serviço ativa sem ele

**Conector de entrega de documentos (`fortes-conecta` via API REST)** — PLANNED

- API oficial com API key; sem automação de browser

---

## M5 — Operações

**Goal:** Tudo que precisa de uma pessoa aparece num lugar só e fica lá até alguém tratar.
**PRD:** OPS-001 a 007, SRV-009, EXE-018, §13 Auditoria

### Features

**Caixa operacional** — PLANNED

- Quatro filas: aprovações, avisos, falhas, problemas de configuração
- Aviso fica até `resolved` ou `ignored`; falha até retry bom ou encerramento; problema de configuração até ser corrigido
- Cada item leva ao run ou cliente que o gerou
- Substitui a fila de aprovações da T27 (que vira uma das quatro filas)
- Tela: Figma "Caixa operacional — filas e inspeção contextual (v2)"

**Reenvio explícito** — PLANNED (D67)

- Reenviar item já entregue: ação separada do retry, com motivo e autor

**Auditoria funcional** — PLANNED

- Trilha de quem fez o quê em cliente, rotina, aprovação, entrega e caixa
- Quem pode cada ação segue a OQ-001

---

## M6 — Acesso e equipe

**Goal:** Pessoas entram por convite, trabalham em mais de um escritório e perdem acesso quando devem.
**PRD:** IAM-001 a 008

### Features

**Convite** — PLANNED (risco R7: envio de e-mail da plataforma)

- Convite por e-mail com papel; aceite cria a membership
- Primeiro admin do escritório entra por convite
- Convite expira; validade, reenvio e revogação ainda TBD no Figma
- Tela: Figma "Equipe — convites e papéis (v2)"

**Vários escritórios** — PLANNED

- Trocar o escritório ativo sem novo login
- Telas já desenhadas: "Pós-login 01 a 04" (escolher, sem escritório, seletor)

**Fim de acesso** — PLANNED

- Escritório desativado, membership removida ou convite expirado: sem acesso, sessão aberta inclusive
- Auditoria de entrada, saída e troca de papel (IAM-008)

**Senha e cadastro** — PLANNED

- Recuperar senha por e-mail (telas "Recuperar senha 01 a 05" no Figma)
- Criação de escritório por autoatendimento (IAM-001)

---

## M7 — UC-001 no piloto

**Goal:** O escritório piloto distribui DAS, DARF e FGTS todo mês pela plataforma. A skill avulsa é aposentada.
**PRD:** §12 UC-001

### Features

**Regras de negócio contábeis** — PLANNED

- Resolução dos documentos exigidos por categoria de cliente
- Validação de conteúdo (competência, CNPJ) como função pura

**Grafo `accounting-routine`** — PLANNED

- Conferência de folha e conferência fiscal x DAS
- Preparo de envio com gate de aprovação antes de qualquer efeito externo
- Envio multicanal por capability

**Migração de dados** — PLANNED

- `clientes.yaml` para a tabela `customers` (D63)
- Schedules dos dias 01, 02, 05, 07 e 10

---

## Future Considerations

- Chat com agentes (spec próprio)
- Billing e limites de gasto por tenant, sobre a contabilidade já coletada
- Segundo tenant real
- Catálogo de conectores MCP dirigido por manifesto, sem deploy
- Banco dedicado por tenant para planos com exigência de isolamento físico
