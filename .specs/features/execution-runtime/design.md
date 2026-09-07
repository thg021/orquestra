# M2 — Runtime de execução: Design

**Spec:** `.specs/features/execution-runtime/spec.md`
**Status:** Proposto
**Data:** 2026-09-07

## Visão geral

O M1 deixou pronta a instância: configurada, com credenciais conectadas e ativa. O M2 constrói o que pega essa instância e a faz acontecer.

O caminho de uma execução, de ponta a ponta:

```
  gatilho                    fila            worker
  (botão ou cron)             │                │
       │                      │                │
       ▼                      ▼                ▼
  ServiceRun ──────────►  job só com  ────►  SET LOCAL app.tenant_id
  status: queued          ponteiros           resolve config + bindings
                                              reavalia o gate do M1
                                                     │
                                                     ▼
                                              grafo do agente
                                              (checkpoint a cada passo)
                                                     │
                                     ┌───────────────┴────────────────┐
                                     │                                │
                              lê documentos                    monta o plano
                              texto → modelo                   de entrega
                              (sem ferramenta                        │
                               nenhuma)                              ▼
                                     │                        ┌──────────────┐
                                     └───────────────────────►│  interrupt   │
                                                              └──────┬───────┘
                                                                     │
                                              ServiceRun: awaiting_approval
                                                                     │
                                                  painel mostra o plano
                                                  30 email · 2 fortes · 80 zap
                                                                     │
                                                  humano aprova ─────┤
                                                                     ▼
                                              retoma do checkpoint
                                              (gate reavaliado de novo)
                                                                     │
                                                                     ▼
                                              entrega item a item
                                              pula o que já foi entregue
                                              1 falha ≠ 80 falhas
                                                                     │
                                                                     ▼
                                              ServiceRun: succeeded
                                              RunStep por item = auditoria
```

Quatro ideias sustentam o desenho:

**Job carrega ponteiro, não conteúdo.** O que entra na fila é `{tenant_id, service_instance_id, run_id, trigger}`. Dado de negócio e segredo ficam no banco, atrás do RLS. Uma fila comprometida não vaza nada além de identificadores.

**Reexecutar é retomar, nunca recomeçar.** Se a fila reentregar o mesmo job — porque o worker morreu, porque a rede piscou — o worker carrega o checkpoint e continua. Não existe caminho que rode o passo 1 duas vezes.

**Aprovar é liberar aquela rodada, não abrir a porteira.** A aprovação vale para um `ApprovalRequest` de um run. Na retomada, o gate de ativação do M1 roda de novo: se uma conexão foi revogada enquanto o humano pensava, a execução para ali.

**O modelo lê, o adapter age.** A chamada de extração não tem ferramenta nenhuma disponível. O modelo recebe texto e devolve JSON validado por schema. Ele não pode enviar, não pode ler credencial, não pode decidir o que fazer — só descrever o que viu.

---

## Componentes

### Motor de execução (`apps/api/src/execution`)

Três papéis de processo, uma imagem só — o `PROCESS_ROLE` já existe desde o M0:

| Papel | O que faz |
| --- | --- |
| `api` | Cria run por ação do usuário; serve histórico e decisões de aprovação |
| `worker` | Consome a fila e executa o grafo |
| `scheduler` | Acorda de tempos em tempos e enfileira o que está na hora |

O worker não é um servidor HTTP. Ele sobe, conecta na fila, e processa. Quando o `PROCESS_ROLE` não é `api`, o bootstrap já devolve sem criar app Nest — falta só ligar o consumidor.

### Checkpointer próprio (`packages/db/src/checkpointer`)

O LangGraph traz um checkpointer de Postgres pronto, e ele cria as próprias tabelas — sem `tenant_id`, sem RLS.

Isso é um problema silencioso: o teste de introspecção do M0 só cobra RLS de tabela que **tem** coluna `tenant_id`. As tabelas da biblioteca passariam despercebidas, guardando estado de execução de todos os escritórios no mesmo lugar, sem isolamento nenhum.

Então o M2 implementa a interface `BaseCheckpointSaver` sobre uma tabela nossa, com `tenant_id` e policy como qualquer outra. São quatro métodos (`getTuple`, `list`, `put`, `putWrites`) e o ganho é manter a invariante do M0 intacta em vez de abrir exceção para ela.

### Plano de entrega (`packages/core/src/delivery`)

O plano é dado puro — nenhuma dependência de banco, fila ou fornecedor:

```ts
interface DeliveryItem {
  idempotencyKey: string;   // quem compõe é o agente
  capability: Capability;   // email | messaging | document-delivery
  recipient: string;        // endereço, número, id no fornecedor
  subject?: string;
  body: string;
  attachments: DeliveryAttachment[];
}

interface DeliveryAttachment {
  sourceRef: string;        // ponteiro no file-storage, nunca os bytes
  filename: string;
}
```

Anexo é ponteiro, não conteúdo. Um plano com 80 PDFs embutidos seria um payload gigante trafegando por fila, checkpoint e tela de aprovação — e cada cópia é mais um lugar de onde vazar.

A chave de idempotência é composta pelo agente, porque só ele sabe o que significa "a mesma entrega". Na rotina contábil ela nasce de cliente + mês + categoria + canal — exatamente o que o arquivo `_controle/<mês>_<categoria>.enviado` marca hoje.

### Leitor de documento (`packages/core/src/documents` + gateway)

Dois passos, e o segundo quase nunca acontece:

```
  PDF
   │
   ├─► extrai texto local ──► tem texto? ──sim──► manda o texto ao modelo
   │                              │
   │                              não
   │                              │
   └─────────────────────────────►└──► renderiza a página ──► manda a imagem
                                                                    │
                                                                    ▼
                                                    resposta validada por schema
                                                    { tipo, cnpj, nome,
                                                      vencimento, competencia }
                                                                    │
                                          ┌─────────────────────────┤
                                          │                         │
                                    passou no schema          fora do formato
                                          │                         │
                                          ▼                         ▼
                                 confere com o cadastro     documento reprovado
                                 (regra pura, sem modelo)   rodada continua
```

A conferência — CNPJ bate? nome bate? competência é a do mês? — é função pura, testável sem rede e sem modelo. O modelo só transforma PDF em campos; quem julga é código.

### Gateway de LLM (`apps/api/src/llm`)

Um ponto único de saída para o OpenRouter. Ele recebe o pedido de extração, escolhe o modelo configurado para aquele agente, chama, mede e devolve.

Mede o quê: tokens de entrada, tokens de saída e custo — gravados no `RunStep` daquele documento. O custo do run é a soma dos passos, e é isso que aparece no painel.

O gateway é também onde a defesa contra injeção é estrutural: a chamada de extração **não declara ferramenta nenhuma**. Não é uma instrução pedindo ao modelo que se comporte — é a ausência de qualquer coisa que ele pudesse acionar.

### Agendador (`apps/api/src/scheduling`)

Acorda a cada minuto e reivindica o que venceu, num `UPDATE` atômico:

```sql
update schedules
   set next_run_at = <próxima ocorrência DEPOIS de agora>,
       last_claimed_at = now()
 where next_run_at <= now()
   and enabled
returning *
```

Dois detalhes que resolvem dois problemas de uma vez:

- **Dois schedulers rodando** — o `UPDATE ... RETURNING` só devolve linha para quem chegou primeiro. O segundo não vê nada para fazer. Sem lock distribuído.
- **Voltar depois de horas fora do ar** — a próxima ocorrência é calculada a partir de *agora*, não da janela perdida. Ficar 6 horas fora não gera 6 disparos.

---

## Modelo de dados

Cinco tabelas novas, todas de tenant, todas com RLS pela convenção do M0.

```
service_instances (M1)
        │
        │ 1:N
        ▼
  service_runs ─────────1:N────────► run_steps
        │                                 │
        │ 1:N                             │ (um passo por item entregue,
        ▼                                 │  por documento lido, por nó do grafo)
  approval_requests                       │
        │                                 │
        └── payload = o plano ────────────┘

  graph_checkpoints          delivery_receipts
  (estado do grafo,          (o que já foi entregue —
   thread = run)              sobrevive ao run)

  schedules  ──── dispara ────► service_runs
```

**`service_runs`** — a execução. `trigger` (`manual` | `scheduled`), `status` (`queued` | `running` | `awaiting_approval` | `succeeded` | `failed`), tempos, erro sanitizado e custo acumulado.

**`run_steps`** — a trilha. Um passo por nó do grafo, por documento lido e por item entregue. Guarda tipo, resultado, tokens e custo. É o sucessor do `log.jsonl`.

**`approval_requests`** — o pedido de decisão. Guarda o plano no `payload`, o status (`pending` | `approved` | `rejected`), quem decidiu e quando. Único por run enquanto pendente.

**`delivery_receipts`** — o que já foi entregue. Índice único em `(tenant_id, service_instance_id, idempotency_key)`. É a tabela que faz "rodar de novo" não reenviar. Vive fora do run de propósito: a rodada do mês que vem precisa enxergar a do mês passado.

**`schedules`** — recorrência por instância: expressão cron, fuso, `next_run_at`, ativo.

**`graph_checkpoints`** — estado serializado do grafo, chaveado por run. Tabela nossa, com `tenant_id` e policy, pelo motivo explicado acima.

---

## Fluxos

### Execução com aprovação (RUN, GRA, APR)

```
  1. gatilho          cria ServiceRun(queued) + enfileira ponteiros
  2. worker           SET LOCAL app.tenant_id
  3. worker           instância ainda active? gate do M1 ainda passa?
                      não → run falha aqui, sem tocar em nada
  4. worker           executa o grafo, checkpoint a cada nó
  5. grafo            monta o plano de entrega
  6. grafo            interrupt  →  ApprovalRequest(pending)
                                    ServiceRun(awaiting_approval)
  7. humano           aprova no painel
  8. worker           REAVALIA o gate  →  retoma do checkpoint
  9. worker           entrega item a item
 10. worker           ServiceRun(succeeded)
```

O passo 8 é o que impede o buraco mais óbvio: aprovar às 9h e entregar às 14h, com a credencial revogada às 11h no meio.

### Entrega item a item (DEL)

```
  para cada item do plano:
        │
        ├─ já existe recibo com esta chave? ──sim──► pula, registra "já entregue"
        │
        não
        │
        ├─ resolve a conexão vinculada àquela capability
        ├─ chama o adapter
        │
        ├── sucesso ──► grava recibo + RunStep(ok)
        └── falha   ──► grava RunStep(falhou, motivo)   ← sem recibo,
                        segue para o próximo item          próxima rodada tenta de novo
```

Recibo só nasce de sucesso. É a mesma regra do marcador `.enviado` de hoje: falhou, não marca, tenta na próxima.

### Retomada depois de queda (RUN-04, RUN-06)

```
  fila reentrega o job do run X
        │
        ▼
  qual o status de X?
        │
        ├─ succeeded / failed  ──► ignora, não faz nada
        ├─ awaiting_approval   ──► ignora, quem retoma é a decisão do humano
        └─ queued / running    ──► carrega checkpoint e CONTINUA
                                   (nunca recomeça do zero)
```

Não existe "detectar duplicata e abortar". Existe "sempre retomar" — e retomar um run que já terminou é não fazer nada.

---

## Superfície de API

```
POST   /service-instances/:id/runs                    RUN-01   dispara à mão
GET    /service-instances/:id/runs                    OBS-01   histórico
GET    /runs/:id                                      OBS-02   detalhe + passos
GET    /approvals                                     APR-01   fila de pendentes
POST   /approvals/:id/approve                         APR-03
POST   /approvals/:id/reject                          APR-04
GET    /service-instances/:id/schedule                SCH-01
PUT    /service-instances/:id/schedule                SCH-01
DELETE /service-instances/:id/schedule                SCH-01
```

Mesma convenção do M1: `owner`/`admin` escrevem, `operator` só lê. Aprovar é escrita — `operator` recebe 403.

## Painel

| Tela | Conteúdo |
| --- | --- |
| Instância → aba Execuções | Lista de runs com status, horário e custo; botão de disparo manual |
| Execução | Passos na ordem, com resultado; para entrega, o resultado por item (entregue / falhou / pulado) |
| Aprovações | Fila de pendentes; ao abrir, o plano com contagem por canal e a lista de destinatários, anexos e texto |
| Instância → aba Agendamento | Expressão de recorrência, fuso e próximo disparo |

A tela de aprovação é a mais importante do M2. Ela é o relatório que a skill de hoje imprime no chat — só que persistido, auditável e ligado ao run que ela libera.

## Tratamento de erros

| Situação | Resposta | O que o usuário vê |
| --- | --- | --- |
| Disparo em instância não ativa | 409 | "Este serviço não está ativo." |
| Aprovação já decidida | 409 | "Esta aprovação já foi decidida." |
| Aprovação por quem não tem papel | 403 | "Você não tem permissão para esta ação." |
| Gate falha na retomada | Run falha | "A configuração mudou desde a aprovação: <o que mudou>." |
| Adapter falha num item | Item falha | Motivo no item, rodada segue |
| Documento ilegível | Documento reprovado | "Não foi possível ler este documento." |
| Modelo fora do schema | Documento reprovado | Mesma mensagem — o detalhe técnico vai para o passo |
| Tempo máximo estourado | Run falha | "A execução passou do tempo limite." |

Regra herdada do M0 e do M1: nenhuma mensagem carrega segredo, chave, prompt bruto ou string de conexão.

## Estratégia de teste

**1. Contenção de efeito (o gate do M2).** O equivalente ao teste de segredo do M1. Um adapter de teste que registra toda chamada recebida; um agente de exercício que monta plano e pede aprovação. O teste roda até a aprovação e afirma: **zero chamadas ao adapter**. Depois aprova e afirma que as chamadas aconteceram. Se algum caminho futuro entregar antes do "sim", este teste cai. (APR-02)

**2. Idempotência de entrega.** Plano de dez itens, três falham de propósito. Sete recibos. Roda de novo: só os três são tentados. (DEL-05)

**3. Retomada.** Agente de três passos, processo derrubado depois do segundo. Sobe de novo: só o terceiro executa. (GRA-02)

**4. Injeção via documento.** PDF com instrução embutida mandando o sistema fazer outra coisa. O comportamento não muda, e a resposta do modelo continua sendo só os campos do schema. (DOC-05)

**5. Agendamento.** Janela reivindicada por um só scheduler entre dois concorrentes; scheduler parado por várias janelas dispara uma vez ao voltar, não N. (SCH-04, SCH-05)

**6. Isolamento.** As cinco tabelas novas entram sozinhas no teste de introspecção do M0 — inclusive `graph_checkpoints`, que é o motivo de ela ser nossa e não da biblioteca.

## Decisões técnicas

| Decisão | Alternativa descartada | Por quê |
| --- | --- | --- |
| Checkpointer próprio sobre tabela com RLS | Checkpointer pronto do LangGraph | O pronto cria tabela sem `tenant_id`; passaria batido no teste de RLS e guardaria estado de todos os tenants junto |
| Anexo como ponteiro no plano | Bytes embutidos no plano | Payload trafega por fila, checkpoint e tela; cada cópia é superfície de vazamento |
| Chave de idempotência composta pelo agente | Chave gerada pelo runtime | Só o agente sabe o que significa "a mesma entrega" — cliente + mês + categoria + canal |
| Reentrega da fila retoma do checkpoint | Detectar duplicata e abortar | "Sempre retomar" resolve queda e duplicata com uma regra só |
| Gate do M1 reavaliado na retomada | Confiar na aprovação | Aprovação e entrega podem estar separadas por horas |
| Extração sem nenhuma ferramenta disponível | Instruir o modelo a não agir | Instrução se contorna; ausência de ferramenta, não |
| `next_run_at` calculado a partir de agora | A partir da janela perdida | Evita rajada de disparos ao voltar de uma queda |
| Adapters de teste no M2 | Esperar os adapters reais do M3 | Deixa o motor ser validado sem depender de credencial de fornecedor |

## Riscos residuais

| Risco | Mitigação |
| --- | --- |
| LangGraph em TypeScript é menos maduro que em Python | O uso é raso: nós, estado e interrupt. Se travar, o mesmo desenho roda com máquina de estados própria — o checkpointer já é nosso |
| Custo do modelo por rodada pode surpreender | Custo medido e visível desde o primeiro run; limite por tenant fica para quando houver número real |
| Extração de PDF varia com o layout do contador | O caminho de visão cobre o que o texto não pega; documento não lido vira "não verificável", nunca palpite |
| Fila e banco podem divergir (job sem run, run sem job) | Run é a fonte de verdade; job é ponteiro descartável. Varredura de runs presos na subida do worker |

## Rastreabilidade

| Requisito | Onde é atendido |
| --- | --- |
| RUN-01 a RUN-07 | Motor de execução + `service_runs` / `run_steps` |
| GRA-01 a GRA-05 | Grafo + checkpointer próprio |
| APR-01 a APR-08 | `approval_requests` + reavaliação do gate do M1 |
| DEL-01 a DEL-07 | Plano de entrega + `delivery_receipts` |
| DOC-01 a DOC-07 | Leitor de documento + gateway de LLM |
| SCH-01 a SCH-05 | Agendador + `schedules` |
| OBS-01 a OBS-05 | Painel de execuções + `run_steps` |
