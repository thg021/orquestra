# State

**Última atualização:** 2026-09-05
**Fase atual:** M0 — Fundação (planejamento)

## Decisões

| # | Data | Decisão | Onde está registrada |
|---|---|---|---|
| D1 | 2026-09-05 | Service instance como unidade central do modelo, em vez de agentes como capabilities soltas do tenant | design §3 D1 |
| D2 | 2026-09-05 | Postgres compartilhado com `tenant_id` + RLS (não schema nem banco por tenant) | design §3 D2 |
| D3 | 2026-09-05 | Monólito modular em papéis de processo (`api`/`worker`/`scheduler` da mesma imagem) | design §3 D3 |
| D4 | 2026-09-05 | Conectores como ports/adapters (ACL); agente nunca importa SDK de fornecedor | design §3 D4 |
| D5 | 2026-09-05 | MCP como tipo de adapter de primeira classe, ao lado de adapters nativos | design §3 D5 |
| D6 | 2026-09-05 | Aprovação humana é primitiva do runtime, não lógica de agente | design §3 D6 |
| D7 | 2026-09-05 | OpenRouter como gateway único de LLM, com custo por `RunStep` | design §3 D7 |
| D8 | 2026-09-05 | Segredos por envelope encryption, write-only, inalcançáveis pelo LLM | ADR-001 |
| D9 | 2026-09-05 | Credencial autenticada uma vez por tenant e reutilizável entre serviços | design §4 |
| D10 | 2026-09-05 | Fortes Conecta via API REST oficial, não Playwright — remove o browser do sistema | design §7 |
| D11 | 2026-09-05 | Chat com agentes fica fora do MVP, com spec próprio depois | design §2 |
| D12 | 2026-09-05 | Identificadores, tabelas e collections em inglês; texto de usuário em português | design §3 |
| D13 | 2026-09-05 | `file-storage` (entrada) tem três adapters — `onedrive`, `google-drive`, `platform-upload` — e o tenant escolhe um. Nenhum é caminho único. | design §7 |
| D14 | 2026-09-05 | A saída tem três vias (Fortes Conecta, e-mail, WhatsApp) que coexistem; a escolha é **por destinatário**, resolvida pelo agente a partir do canal em `customers`, não pela configuração da instância. | design §4, §7 |
| D15 | 2026-09-05 | Capabilities podem ser obrigatórias ou opcionais; um serviço ativa sem os bindings opcionais (ex.: escritório que não usa WhatsApp). | design §4 |

## Bloqueios e riscos abertos

| # | Risco | Quando resolver |
|---|---|---|
| ~~R1~~ | ~~Graph API com conta Microsoft pessoal pode não funcionar.~~ **Fechado em 2026-09-05** — mitigado por desenho: `file-storage` tem três adapters (`onedrive`, `google-drive`, `platform-upload`). Provar a Graph API no M3 continua valendo, mas não é bloqueante. | — |
| ~~R2~~ | ~~Cobertura da API do Fortes Conecta.~~ **Fechado em 2026-09-05** — não é risco: há três vias de entrega escolhidas por destinatário; lacuna no Fortes afeta só os clientes daquele canal. | — |
| R3 | NestJS e BullMQ são escolhas de conveniência ainda não validadas na prática. | Revisáveis na Fase 0 sem impacto no resto do design. |
| R4 | Reescrever regras hoje implícitas no prompt da skill pode perder comportamento. | Cada regra migrada vira teste antes de virar código (M4). |

## Lições

_(vazio — preencher conforme a implementação avança)_

## Todos

- [ ] Definir a estrutura do monorepo (pacotes e fronteiras) na Fase 0
- [ ] Provar a Graph API com a conta pessoal no M3 (não bloqueante — define só qual adapter de `file-storage` o tenant piloto usa)
- [ ] Levantar a documentação da API do Fortes Conecta ao iniciar o adapter
- [ ] Extrair as regras de negócio da skill `rotina-contabil` para uma lista de casos de teste antes do M4

## Ideias adiadas

- Catálogo de conectores MCP dirigido por manifesto, sem deploy
- Banco dedicado por tenant para planos com exigência de isolamento físico
- Limites de gasto por tenant sobre a contabilidade de custo já coletada
- Onboarding self-service para novos tenants

## Preferências

_(vazio)_

## Fontes de verdade

- Design arquitetural: `docs/specs/2026-09-05-orquestra-design.md`
- Decisões: `docs/adr/`
- Especificação de origem do agente contábil: skill `rotina-contabil` em `C:/Users/thiago.silva/projects/escritorio/.claude/skills/rotina-contabil/` (incluindo `references/` e `clientes.yaml`)
