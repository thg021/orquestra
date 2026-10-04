# PRD MVP × o que existe hoje

Fonte: `PRD-Orquestra-MVP-v1.0.md` (Codex, 2026-10-03).
Comparado com: código em `main` (até T13 do M2), `ROADMAP.md`, `STATE.md` e os `tasks.md` de M0–M2.
Data: 2026-10-04.

Legenda: ✅ existe · 🟡 existe em parte ou só especificado · ❌ não existe · ⚠️ conflita com uma decisão registrada

---

## 1. Os nomes do PRD e os nossos

O PRD usa outros nomes para coisas que já temos. Sem esse mapa, metade dos requisitos parece faltar.

```
  PRD                      Orquestra hoje                     situação
  ───────────────────────  ─────────────────────────────────  ─────────────
  Agent / AgentVersion     AgentDefinition (catálogo)         ✅
  Service (catálogo)       ConnectorDefinition                ✅
  Capability               Capability                         ✅
  Service Instance         ConnectorConnection                🟡 nós aceitamos várias por conector
  Connection               ConnectorConnection                ✅
  Binding                  ConnectorBinding                   ✅ (o PRD chama de opcional)
  Automation               ServiceInstance                    🟡 falta audiência, routing, seleção
  Schedule                 Schedule (T23)                     🟡 especificado
  Execution                ServiceRun                         ✅
  CustomerRun              —                                  ❌
  Customer                 collection `customers` da instância ⚠️ ver conflito C1
  Enrollment               —                                  ❌
  Delivery Plan            plano de entrega (T16)             🟡 especificado
  Delivery Package         —                                  ❌
  Human Gate               ApprovalRequest (T12/T13)          ✅
  Delivery Attempt         RunStep por item (T17)             🟡 especificado
  Receipt / Ledger         delivery_receipts                  ✅ tabela; uso na T18
  Warning                  —                                  ❌
  Operational Inbox        fila de aprovações (T27)           🟡 só aprovações
  Administrator / Operator owner, admin, operator             ✅ (temos um papel a mais)
```

---

## 2. Conflitos com decisões já tomadas — respondidos em 2026-10-04

| # | Tema | Resposta | Registro |
|---|---|---|---|
| C1 | Cliente com cadastro próprio | Seguir o PRD | D63 (revisa D41) |
| C2 | Seleção por nome × por conteúdo | PRD + D42: nome primeiro, conteúdo depois | D64 (revisa D42) |
| C3 | Canal configurado na rotina | Seguir o PRD | D65 (revisa D14) |
| C4 | Uma ou várias conexões por conector | Em aberto — recomendação: manter várias | STATE §Todos |
| C5 | Papéis | Manter `owner`, `admin`, `operator` | D66 |
| C6 | Retry automático ×3 | Seguir o PRD | D67 |

---

## 3. Requisito por requisito

### Identity & Access (IAM)

| ID | Situação | Observação |
|---|---|---|
| IAM-001 tenant por autoatendimento | ❌ | Hoje só `pnpm cli tenant:create` |
| IAM-001 provisionamento pela Orquestra | ✅ | CLI |
| IAM-002/003 entrada por convite | ❌ | Não há convite nem envio de e-mail |
| IAM-004 aceite cria Membership | ❌ | Depende do convite |
| IAM-005 alternar tenant | 🟡 | Banco aceita várias memberships; sessão guarda um `tenant_id` fixo e não há troca |
| IAM-006 autorização por tenant e papel | ✅ | RLS + guard de papel |
| IAM-007 tenant desativado / convite expirado | ❌ | `tenants` não tem status |
| IAM-007 usuário removido | 🟡 | Remover membership existe (`LAST_OWNER_PROTECTED`), mas sessão aberta não é derrubada — conferir |
| IAM-008 auditoria de Membership | ❌ | Não há trilha de auditoria fora do runtime |

### Customer (CUS)

| ID | Situação | Observação |
|---|---|---|
| CUS-001 cadastro com CNPJ | ❌ | Dado só por seed (D41) |
| CUS-002 ACTIVE / INACTIVE | ❌ | |
| CUS-003 vários contatos | ❌ | D32 define o vocabulário do canal, não a estrutura |
| CUS-004 grupos | ❌ | |
| CUS-005 modelo pronto para CPF | ❌ | Decidir na modelagem |
| CUS-006 INACTIVE fora de ALL_ACTIVE | ❌ | Depende de audiência |

### Agent (AGT)

| ID | Situação | Observação |
|---|---|---|
| AGT-001 agente sem provider | ✅ | D4 |
| AGT-002 versão explícita | ✅ | Instância fixa a versão |
| AGT-003 requirements tipados | ✅ | Capabilities obrigatórias e opcionais (D15) |
| AGT-004 checar requirements antes de ativar | ✅ | Gate de ativação (D28) |
| AGT-005 declarar side effect / Human Gate | 🟡 | `interrupt` no grafo; não é uma declaração do agente |

### Service (SRV)

| ID | Situação | Observação |
|---|---|---|
| SRV-001 catálogo só da Orquestra | ✅ | D22 |
| SRV-002 só admin instala | ✅ | |
| SRV-003 uma instance por Service/Tenant | ⚠️ | C4 |
| SRV-004 credencial do tenant | ✅ | D9, ADR-001 |
| SRV-005 Connection + Binding opcional | ✅ | |
| SRV-006 capability declara `sideEffect` | ❌ | Campo não existe no catálogo |
| SRV-007 health / pre-flight | 🟡 | Responde `unverified` até ter adapter (M3) |
| SRV-008 provider por capability + override | 🟡 | Binding resolve por instância; override por Customer não existe |
| SRV-009 configuration issue na Inbox | ❌ | Depende da Inbox |

### Automation (AUT)

| ID | Situação | Observação |
|---|---|---|
| AUT-001 criar a partir de AgentVersion | ✅ | Instalar instância |
| AUT-002 audiência ALL_ACTIVE / SELECTED | ❌ | |
| AUT-003 Enrollment com estado | ❌ | |
| AUT-004 um schedule + manual | 🟡 | Manual ✅ (T6); schedule em T23/T24 |
| AUT-005 defaults + override por Customer | 🟡 | Config da instância ✅; override ❌ |
| AUT-006 routing | ⚠️ | C3 |
| AUT-007/008 seleção por nome e extensão | ⚠️ | C2 |
| AUT-009 Expected Artifacts → warning | ❌ | |
| AUT-010 readiness antes de ativar | 🟡 | Gate cobre config e capability; não cobre audiência nem dados |
| AUT-011 DRAFT/ACTIVE/PAUSED/ARCHIVED | 🟡 | Temos instalado/ativo/pausado/removido; conferir nomes |
| AUT-012 só ACTIVE agenda | 🟡 | Regra de T6 vale para manual; agendamento em T24 |

### Execution (EXE)

| ID | Situação | Observação |
|---|---|---|
| EXE-001 rodada manual ou agendada | 🟡 | Manual ✅; agendada T24 |
| EXE-002 CustomerRuns isolados | ❌ | O run é um só para todos os clientes |
| EXE-003 rastrear descoberta, filtro, warning | 🟡 | `RunStep` por nó ✅; artifact como entidade ❌ |
| EXE-004 reconciliar com o ledger | 🟡 | T18 |
| EXE-005/006 COMPLETED, NOTHING_TO_DO | ❌ | Run termina em `succeeded`/`failed`; ver OQ-005 |
| EXE-007 warning separado de status | ❌ | |
| EXE-008 Delivery Plan + Packages | 🟡 | Plano na T16; package (anexos agrupados) ❌ |
| EXE-009 aprovação em batch | ✅ | Um pedido por run |
| EXE-010 snapshot imutável do plano | 🟡 | Payload do pedido guarda o plano; imutabilidade não é garantida no banco |
| EXE-011 nada antes da aprovação | 🟡 | T15 é o gate que prova isso |
| EXE-012 Attempt + Receipt | 🟡 | T17 |
| EXE-013 falha de um canal não para outro → PARTIAL_FAILURE | 🟡 | Isolamento na T17; status `PARTIAL_FAILURE` ❌ |
| EXE-014 retry automático ×3 | ❌ | C6 |
| EXE-015 retry manual só do que falhou | 🟡 | T18 garante; falta o botão/endpoint |
| EXE-016 plano mudou → nova aprovação | 🟡 | T14 reavalia gate; comparar plano ❌ |
| EXE-017 não repetir concluído | 🟡 | T18 |
| EXE-018 reenvio explícito e auditado | ❌ | |

### Operations (OPS)

| ID | Situação | Observação |
|---|---|---|
| OPS-001 Inbox compartilhada | 🟡 | T27 é só fila de aprovações |
| OPS-002 Approvals | 🟡 | T27 |
| OPS-002 Warnings, Failures, Config issues | ❌ | |
| OPS-003/004/005 resolver / ignorar / encerrar | ❌ | |
| OPS-006 link para o run de origem | 🟡 | T26 dá o detalhe do run |
| OPS-007 fora: notificação, SLA | ✅ | Nada a fazer |

### Transversal

| Item | Situação | Observação |
|---|---|---|
| BR-001 isolamento de tenant | ✅ | RLS, teste de introspecção |
| Segredo fora de log e tela | ✅ | Teste de contenção do M1 |
| Auditoria funcional (seção 13) | 🟡 | Runtime tem `RunStep`; Customer, Automation e Inbox não |
| Métricas (seção 16) | 🟡 | Custo por passo ✅; contadores do PRD ❌ |

---

## 4. Resumo em números

```
  linhas da seção 3:
  ✅ existe            15
  🟡 em parte / spec   26
  ❌ não existe        23
  ⚠️ conflito           3   (os conflitos completos são C1 a C6, seção 2)
```

---

## 5. Onde cada lacuna cabe

O ROADMAP foi reorganizado a partir desta comparação. Cada milestone lista os IDs do PRD que cobre.

```
  M2  Runtime de execução   + T30 a T35 (status, plano imutável, retry, aviso)
  M3  Carteira e automação  CUS, AUT, CustomerRun, seleção de documento
  M4  Conectores reais      SRV-006/007, conectores do UC-001
  M5  Operações             OPS, reenvio, auditoria funcional
  M6  Acesso e equipe       IAM
  M7  UC-001 no piloto      agente contábil
```

## 6. O que ainda falta decidir

Está em `STATE.md` §Todos: C4, OQ-001, OQ-002, OQ-003, OQ-005. Cada um diz qual task ou milestone ele bloqueia.
