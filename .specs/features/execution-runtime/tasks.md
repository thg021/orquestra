# M2 — Runtime de execução: Tasks

**Design:** `.specs/features/execution-runtime/design.md`
**Spec:** `.specs/features/execution-runtime/spec.md`
**Testing:** `.specs/codebase/TESTING.md`
**Status:** Em andamento — 10 de 29 tasks (T1 a T10 concluídas)

29 tasks. Uma entrega por task, com teste co-locado.

---

## Execution Plan

### Fase 1 — Persistência do runtime (destrava tudo)

```
T1 ──┬──► T2
     └──► T3
```

### Fase 2 — Fila e worker

```
T2 ──► T4 ──► T5 ──► T7
        │             ▲
        └──► T6 ──────┘
```

### Fase 3 — Grafo

```
T1 ──► T8 ──┐
            ├──► T10 ──► T11
T9 ─────────┘
```

### Fase 4 — Aprovação (o coração do milestone)

```
T10 ──► T12 ──► T13 ──► T14 ──► T15
                 ▲
T3 ──────────────┘
```

### Fase 5 — Entrega

```
T16 ──► T17 ──► T18
         ▲
T3 ──────┘
```

### Fase 6 — Documento e LLM

```
T19 ──► T21 ──► T22
         ▲
T20 ─────┘
```

### Fase 7 — Agendamento

```
T3 ──► T23 ──► T24
```

### Fase 8 — Painel

```
T13 ──► T25 ──┬──► T26
              ├──► T27
T23 ──────────┴──► T28
```

### Fase 9 — Fechamento

```
T15, T18, T22, T24, T28 ──► T29
```

**Paralelizável:** as fases 5 e 6 não dependem uma da outra nem da fase 4 depois do T12. As fases 3 e 5 podem andar juntas depois do T3.

---

### T1: Tabelas do runtime

**What:** as seis tabelas novas numa migração só, com `tenant_id`, RLS habilitada e forçada, e policy no padrão do M0.
**Where:** `packages/db/src/schema/execution.ts`, `packages/db/migrations/`
**Depends on:** —
**Reuses:** convenção de RLS do M0, `bytea`/`jsonb` do M1
**Requirement:** RUN-05, GRA-04, APR-01, DEL-05, SCH-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `service_runs`, `run_steps`, `approval_requests`, `delivery_receipts`, `schedules` e `graph_checkpoints` existem com `tenant_id`
- [x] As seis aparecem cobertas pelo teste de introspecção de RLS do M0 sem editar esse teste
- [x] A migração gerada recebeu à mão o `FORCE ROW LEVEL SECURITY` de cada tabela (o `drizzle-kit` 0.28 não gera)
- [x] `delivery_receipts` tem índice único em `(tenant_id, service_instance_id, idempotency_key)`
- [x] `approval_requests` impede dois pedidos pendentes para o mesmo run

**Feito em 07/09/2026.** Migração `0003_execution_runtime.sql`. Três detalhes que valem registro: o índice de aprovação é **parcial** (`where status = 'pending'`), então um run pode ter vários pedidos ao longo do grafo desde que só um esteja aberto por vez; `cost_usd` é `numeric(12,6)` e não float, porque custo é dinheiro e some centavo em arredondamento binário; e `run_steps` tem `seq` com unicidade por run, porque o relógio não serve para ordenar — dois passos caem no mesmo instante. O helper de policy precisou do tipo `ExtraConfigColumn`, não do builder de coluna: dentro do callback de config o Drizzle entrega outra coisa.

---

### T2: Repositórios de execução

**What:** criar run, transicionar status, gravar passo e listar — sempre recebendo `Tx`, nunca abrindo pool.
**Where:** `packages/db/src/repositories/service-runs.repository.ts`, `run-steps.repository.ts`
**Depends on:** T1
**Reuses:** disciplina `withTenant` do M0
**Requirement:** RUN-01, RUN-05, OBS-01, OBS-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Transição de status é explícita: a função recusa ir de um estado final para outro estado
- [x] Passos saem na ordem em que aconteceram
- [x] Custo do run é a soma dos passos, calculada no banco e não em memória
- [x] Isolamento: run de outro tenant não aparece na listagem nem por id

**Feito em 07/09/2026.** `transitionServiceRunStatus` usa `UPDATE ... WHERE status NOT IN (final)` como guarda atômica — sem janela entre ler e escrever, sem SELECT antes do UPDATE. Zero linha afetada e o run existe → estava num estado final; lança `IllegalRunTransitionError`. Entrar em `running` grava `startedAt`; entrar em `succeeded`/`failed` grava `finishedAt`. `sumRunCost` soma no banco com `coalesce(sum(...), 0)` — run sem passo nenhum devolve `0`, nunca `null`, porque quem consome esse número não deveria ter que checar por `null` antes de somar.

---

### T3: Repositórios de aprovação, recibo e agendamento

**What:** persistência de `approval_requests`, `delivery_receipts` e `schedules`.
**Where:** `packages/db/src/repositories/`
**Depends on:** T1
**Reuses:** T2
**Requirement:** APR-01, APR-05, DEL-05, SCH-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Decidir uma aprovação já decidida não sobrescreve a primeira decisão
- [x] Gravar recibo com chave repetida é recusado pelo banco, não por checagem em memória
- [x] `claimDueSchedules` reivindica com `UPDATE ... RETURNING` e avança `next_run_at` a partir de agora

**Feito em 07/09/2026.** `decideApprovalRequest` e `insertDeliveryReceipt` seguem o mesmo padrão da T2: guarda atômica no `WHERE`/na unicidade do banco, nunca checagem em memória antes de escrever. `claimDueSchedules` varre todo tenant (como o `kek:rotate` do M1) — reivindicação é `UPDATE ... WHERE next_run_at <= now` por linha, então dois schedulers concorrentes nunca reivindicam a mesma: a segunda transação vê o valor já avançado pela primeira e o `WHERE` falha. `next_run_at` é recalculado a partir de `now`, nunca da janela perdida (design D-decisão "next_run_at a partir de agora").

**Dependência nova:** `cron-parser` (em `packages/core`), para calcular a próxima ocorrência de uma expressão cron respeitando fuso horário. Sem ela, `computeNextRunAt` teria que reimplementar aritmética de calendário — risco alto de acertar o caso comum e errar borda de DST/mudança de mês.

---

### T4: Fila e contrato do job

**What:** a fila BullMQ, a conexão Redis e o tipo do job — que carrega só ponteiros.
**Where:** `apps/api/src/execution/queue.ts`
**Depends on:** T2
**Reuses:** `REDIS_URL` do M0
**Requirement:** RUN-01, RUN-07

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] O tipo do job só admite `tenantId`, `serviceInstanceId`, `runId` e `trigger` — ausência no tipo, não disciplina de quem chama
- [x] Existe teste que serializa um job e falha se aparecer qualquer campo além desses
- [x] Perder a conexão com o Redis não derruba o processo `api`

---

### T5: Papel de processo `worker`

**What:** o worker sobe, conecta na fila e processa — sem servidor HTTP.
**Where:** `apps/api/src/main.ts`, `apps/api/src/execution/worker.ts`, `docker/compose.yml`
**Depends on:** T4
**Reuses:** `PROCESS_ROLE` do M0 (o bootstrap já devolve sem app Nest quando não é `api`)
**Requirement:** RUN-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `PROCESS_ROLE=worker` sobe consumindo a fila e não abre porta HTTP
- [x] O worker aparece no compose como serviço próprio, mesma imagem da API
- [x] Encerrar o processo espera o job em andamento terminar antes de sair

---

### T6: Disparo manual de execução

**What:** `POST /service-instances/:id/runs` — cria o run e enfileira.
**Where:** `apps/api/src/execution/runs.controller.ts`, `runs.service.ts`
**Depends on:** T4
**Reuses:** papéis e `getFullAuthContext` do M1
**Requirement:** RUN-01, RUN-03

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Instância `active` cria run `queued` e enfileira
- [x] Instância em qualquer outro estado recebe 409 nomeando o status atual, sem criar run
- [x] `operator` recebe 403; `owner`/`admin` passam

---

### T7: Ciclo de vida do run no worker

**What:** consumir o job, estabelecer o contexto de tenant, mover o status e não deixar run preso.
**Where:** `apps/api/src/execution/run-executor.ts`
**Depends on:** T5, T6
**Reuses:** `withTenant` do M0
**Requirement:** RUN-02, RUN-04, RUN-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] O contexto de tenant é estabelecido antes de qualquer leitura de dado de negócio
- [x] Job reentregue para um run já concluído não executa nada
- [x] Worker derrubado no meio deixa o run recuperável; a subida seguinte o retoma
- [x] Falha inesperada grava o erro sanitizado no run, sem segredo nem string de conexão

---

### T8: Checkpointer próprio

**What:** implementar `BaseCheckpointSaver` do LangGraph sobre `graph_checkpoints`, com `tenant_id` e RLS.
**Where:** `packages/db/src/checkpointer/`
**Depends on:** T1
**Reuses:** `withTenant`
**Requirement:** GRA-01, GRA-04

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] `getTuple`, `list`, `put` e `putWrites` implementados contra a tabela nossa
- [x] Nenhuma tabela criada pela biblioteca aparece no banco depois da migração
- [x] Checkpoint de um tenant não é legível sob o contexto de outro
- [x] Ida e volta: gravar estado, ler de volta e obter exatamente o mesmo estado

---

### T9: Agente executável no catálogo

**What:** a definição de agente passa a declarar seu grafo, e nasce um agente de exercício para o M2 testar contra.
**Where:** `packages/catalog/src/define.ts`, `packages/catalog/src/agents/exercise.ts`
**Depends on:** —
**Reuses:** `defineAgent` do M1
**Requirement:** GRA-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] O grafo é declarado como fábrica preguiçosa — listar o catálogo não constrói grafo nenhum
- [x] O agente de exercício tem passos suficientes para provar checkpoint, aprovação e entrega
- [x] O catálogo continua válido na subida, e a validação recusa agente sem grafo
- [x] `apps/web` continua sem importar `@orquestra/catalog`

---

### T10: Execução do grafo com checkpoint

**What:** o worker monta o grafo do agente e executa, salvando estado a cada nó.
**Where:** `apps/api/src/execution/graph-runner.ts`
**Depends on:** T7, T8, T9
**Reuses:** gate de ativação do M1
**Requirement:** GRA-01, GRA-03, RUN-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [x] Cada nó executado grava um `RunStep`
- [x] Antes de executar, o gate do M1 é reavaliado; se falhar, o run falha sem tocar em nada
- [x] Falha no meio preserva o checkpoint do que já rodou, com o erro no passo correspondente

**Feito em 17/09/2026.** `run-executor.ts` chama `runAgentGraph` (o `graph-runner.ts` novo) no lugar do no-op, dentro da mesma `tx`. Duas decisões não óbvias: `evaluateInstanceActivation` (M1) passou a receber a `Tx` já aberta em vez de abrir a própria via `withTenant` — `activateServiceInstance` agora abre uma `withTenant` por fora e repassa; comportamento observável não mudou (suíte e2e de `lifecycle.controller` continua verde sem alteração). E o grafo roda em modo `stream` (`streamMode: "updates"`), não `invoke`, pra gravar um `RunStep` por nó — um chunk `__interrupt__` (o agente `exercise` pausa em `requestApproval`) não vira `RunStep` nem falha, só não quebra (T12 decide o resto); e o nó que falhou é achado com `compiled.getState(config).next[0]`, porque um nó que lança nunca chega a virar checkpoint. `seq` continua de `listRunSteps(...).length` em vez de zerar — T11 ainda não sabe retomar de verdade, mas isso evita colidir com a unicidade de `(run_id, seq)` numa reentrega. `@langchain/langgraph` virou dependência direta de `apps/api` (já era transitiva).

---

### T11: Retomada e tempo máximo

**What:** continuar do checkpoint sem repetir passo, e encerrar agente que não termina.
**Where:** `apps/api/src/execution/graph-runner.ts`
**Depends on:** T10
**Reuses:** T8
**Requirement:** GRA-02, GRA-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Agente de três passos derrubado depois do segundo: ao retomar, só o terceiro executa
- [ ] O passo já registrado não ganha um segundo `RunStep` na retomada
- [ ] Execução que passa do tempo máximo encerra como falha, sem ficar rodando

---

### T12: Interrupt e pedido de aprovação

**What:** o grafo suspende, nasce o `ApprovalRequest` e o run vai para `awaiting_approval`.
**Where:** `apps/api/src/execution/approval.service.ts`, `graph-runner.ts`
**Depends on:** T10
**Reuses:** T3
**Requirement:** APR-01, APR-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Interrupt salva checkpoint, cria o pedido com o payload e move o run
- [ ] Um run em `awaiting_approval` não é retomado por reentrega da fila — só por decisão
- [ ] O payload do pedido não carrega segredo

---

### T13: API de aprovação

**What:** listar pendentes, aprovar e recusar.
**Where:** `apps/api/src/execution/approvals.controller.ts`
**Depends on:** T12, T3
**Reuses:** `RequireRole` do M1
**Requirement:** APR-03, APR-04, APR-05, APR-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Aprovar registra quem e quando, e reenfileira o run
- [ ] Recusar encerra o run sem executar o pendente, registrando quem e quando
- [ ] Segunda decisão sobre o mesmo pedido recebe 409 e não tem efeito
- [ ] `operator` recebe 403 ao decidir, e 200 ao listar
- [ ] Aprovação de outro tenant responde 404, indistinguível de inexistente

---

### T14: Retomada depois da decisão

**What:** aprovar reenfileira; o worker reavalia o gate antes de continuar do checkpoint.
**Where:** `apps/api/src/execution/run-executor.ts`
**Depends on:** T13
**Reuses:** gate do M1, T11
**Requirement:** APR-03, APR-07, APR-08

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Conexão revogada entre a aprovação e a retomada faz o run falhar nomeando o que mudou
- [ ] Instância pausada entre a aprovação e a retomada tem o mesmo tratamento
- [ ] A aprovação de um run não libera nenhum outro run nem outra rodada

---

### T15: Gate — contenção de efeito ⭐

**What:** o teste que carrega o milestone: nenhum efeito externo antes do "sim".
**Where:** `apps/api/test/effect-containment.e2e.test.ts`
**Depends on:** T14
**Reuses:** infraestrutura de Testcontainers do M0
**Requirement:** APR-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Um adapter de teste registra toda chamada recebida, de qualquer capability
- [ ] O teste roda até a aprovação e afirma zero chamadas ao adapter
- [ ] Depois de aprovar, afirma que as chamadas aconteceram
- [ ] Recusar não produz chamada nenhuma
- [ ] Falha de propósito quando o gate é contornado, provando que o teste morde

---

### T16: O plano de entrega como dado

**What:** os tipos do plano em domínio puro, sem banco, fila nem fornecedor.
**Where:** `packages/core/src/delivery/`
**Depends on:** —
**Reuses:** `Capability` do catálogo (duplicada, como em `contracts`)
**Requirement:** DEL-01, DEL-07

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] O tipo do item não tem campo de segredo — ausência no tipo, não omissão em runtime
- [ ] Anexo é ponteiro (`sourceRef` + `filename`), nunca bytes
- [ ] Plano sem chave de idempotência é recusado na validação
- [ ] Duas chaves iguais no mesmo plano são recusadas

---

### T17: Executor de entrega

**What:** entregar item a item pela conexão vinculada à capability daquele item.
**Where:** `apps/api/src/execution/delivery-executor.ts`
**Depends on:** T16, T3
**Reuses:** bindings do M1
**Requirement:** DEL-02, DEL-03, DEL-04, DEL-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Cada item usa a conexão vinculada à sua capability, resolvida no momento da entrega
- [ ] Falha de um item registra o motivo e a execução segue para o próximo
- [ ] Cada item vira um `RunStep` próprio com resultado
- [ ] Recibo é gravado só em caso de sucesso
- [ ] Capability sem vínculo no momento da entrega falha aquele item, não a rodada

---

### T18: Idempotência de entrega

**What:** rodar de novo não reenvia o que já foi entregue.
**Where:** `apps/api/src/execution/delivery-executor.ts`
**Depends on:** T17
**Reuses:** `delivery_receipts` (T1)
**Requirement:** DEL-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Item com recibo existente é pulado sem chamar adapter nenhum
- [ ] O item pulado aparece no histórico como "já entregue", distinto de "entregue agora"
- [ ] Plano de dez itens com três falhas: sete recibos; rodar de novo tenta só os três
- [ ] Duas execuções simultâneas do mesmo plano não entregam o mesmo item duas vezes

---

### T19: Gateway de LLM

**What:** ponto único de saída para o OpenRouter, medindo tokens e custo.
**Where:** `apps/api/src/llm/`
**Depends on:** T2
**Reuses:** `RunStep` (T2)
**Requirement:** DOC-04, DOC-06

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Deferred:** o modelo por agente vem da configuração; escolha automática de modelo fica fora.

**Done when:**
- [ ] Toda chamada grava tokens de entrada, de saída e custo no passo correspondente
- [ ] O custo do run é a soma dos passos e aparece no run
- [ ] A chamada de extração não declara ferramenta nenhuma
- [ ] Nenhuma credencial de conector entra no prompt — teste com sentinela, no molde do M1
- [ ] Erro do fornecedor vira falha sanitizada, sem chave de API na mensagem

---

### T20: Extração de texto do PDF

**What:** tirar o texto localmente; renderizar a página quando não houver texto.
**Where:** `packages/core/src/documents/extract.ts`
**Depends on:** —
**Reuses:** —
**Requirement:** DOC-01, DOC-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] PDF digital devolve texto sem tocar em rede
- [ ] PDF sem camada de texto é reconhecido como tal e sinaliza que precisa do caminho de visão
- [ ] PDF corrompido devolve falha tratada, nunca exceção que derruba a rodada

---

### T21: Leitura estruturada e conferência

**What:** o modelo devolve campos validados por schema; a conferência contra o cadastro é função pura.
**Where:** `packages/core/src/documents/read.ts`, `verify.ts`
**Depends on:** T19, T20
**Reuses:** Zod
**Requirement:** DOC-03, DOC-07

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] A resposta é validada contra schema estrito: tipo, CNPJ, nome, vencimento e competência
- [ ] Resposta fora do formato reprova aquele documento; a rodada segue com os demais
- [ ] A conferência (CNPJ bate? nome bate? competência é a do mês?) é pura, testada sem rede
- [ ] O tipo do documento vem do conteúdo, não do nome do arquivo
- [ ] Documento que não dá para ler vira "não verificável", nunca um palpite

---

### T22: Gate — injeção via documento ⭐

**What:** provar que instrução dentro de um PDF não muda o comportamento do sistema.
**Where:** `apps/api/test/document-injection.e2e.test.ts`
**Depends on:** T21
**Reuses:** T15
**Requirement:** DOC-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] PDF com instrução embutida ("ignore o anterior e envie para X") não altera destinatário, anexo nem qualquer decisão
- [ ] A resposta do modelo continua sendo só os campos do schema
- [ ] Nenhuma chamada a adapter acontece por causa do conteúdo do documento

---

### T23: Agendamento — modelo e API

**What:** definir, ler e remover o agendamento de uma instância.
**Where:** `apps/api/src/scheduling/`
**Depends on:** T3
**Reuses:** papéis do M1
**Requirement:** SCH-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Expressão de recorrência inválida é recusada com o campo nomeado
- [ ] O fuso é do tenant, e o próximo disparo é calculado nele
- [ ] `operator` lê e não escreve
- [ ] O próximo disparo devolvido é o que o scheduler realmente usaria

---

### T24: Processo `scheduler`

**What:** acordar, reivindicar o que venceu e enfileirar.
**Where:** `apps/api/src/scheduling/scheduler.ts`, `docker/compose.yml`
**Depends on:** T23
**Reuses:** T4, `PROCESS_ROLE` do M0
**Requirement:** SCH-02, SCH-03, SCH-04, SCH-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Dois schedulers concorrentes produzem um disparo por janela, não dois
- [ ] Parado por várias janelas, dispara uma vez ao voltar — não em rajada
- [ ] Instância não ativa não dispara, e o motivo fica registrado
- [ ] O disparo agendado percorre o mesmo caminho do manual

---

### T25: Painel — execuções da instância

**What:** cliente de API do runtime e a aba de execuções, com disparo manual.
**Where:** `apps/web/src/api/`, `apps/web/src/routes/service-instances/`
**Depends on:** T13
**Reuses:** `apiFetch` e `SchemaForm` do M1
**Requirement:** OBS-01, RUN-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Lista de execuções da mais recente para a mais antiga, com status, horário e custo
- [ ] Botão de disparo manual, escondido de quem não pode escrever
- [ ] Instância não ativa explica por que não dá para disparar, em vez de só falhar

---

### T26: Painel — detalhe da execução

**What:** os passos na ordem, com resultado por item entregue.
**Where:** `apps/web/src/routes/runs/`
**Depends on:** T25
**Reuses:** T25
**Requirement:** OBS-02, OBS-03, OBS-04, OBS-05

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Passos na ordem, com resultado de cada um
- [ ] Entrega mostra por item: entregue, falhou ou pulado por já ter sido entregue
- [ ] Erro aparece sem segredo, chave nem string de conexão
- [ ] Custo acumulado da execução visível

---

### T27: Painel — fila de aprovações ⭐

**What:** a tela mais importante do M2: ver o que vai sair e decidir.
**Where:** `apps/web/src/routes/approvals/`
**Depends on:** T25
**Reuses:** T25
**Requirement:** APR-03, APR-04, DEL-02

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Fila de pendentes com instância, horário e quantos itens
- [ ] O plano mostra a contagem por canal, nunca agregada num número só
- [ ] Cada item mostra destinatário, anexos e o texto que será enviado
- [ ] Aprovar e recusar exigem papel de escrita; `operator` vê e não decide
- [ ] Decidir duas vezes (duplo clique) não produz duas decisões

---

### T28: Painel — agendamento

**What:** aba para definir recorrência e ver o próximo disparo.
**Where:** `apps/web/src/routes/service-instances/`
**Depends on:** T23, T25
**Reuses:** T25
**Requirement:** SCH-01

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Recorrência e fuso editáveis, com o próximo disparo exibido
- [ ] Expressão inválida mostra o erro ao lado do campo
- [ ] Remover o agendamento não afeta execuções já registradas

---

### T29: Fechamento do milestone

**What:** e2e do fluxo completo (disparar → ler documento → aprovar → entregar), atualização de ROADMAP e STATE.
**Where:** `apps/web/test/`, `.specs/project/{ROADMAP.md,STATE.md}`, `README.md`
**Depends on:** T15, T18, T22, T24, T28
**Reuses:** —
**Requirement:** todos os Success Criteria da spec

**Tools:** MCP: NENHUM · Skill: NENHUMA

**Done when:**
- [ ] Um percurso e2e vai do disparo à entrega, passando pela aprovação
- [ ] `pnpm check` verde
- [ ] ROADMAP marca o M2 concluído; STATE registra decisões, lições e riscos do milestone
- [ ] README documenta os papéis de processo (`worker`, `scheduler`) para o operador
