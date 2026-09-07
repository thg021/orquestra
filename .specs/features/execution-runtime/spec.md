# M2 — Runtime de execução: Especificação

**Milestone:** M2 — Runtime de execução
**Status:** Especificado
**Data:** 2026-09-07

## Problem Statement

O M1 entregou tudo o que cerca a execução, menos a execução. Um escritório instala o agente, configura, conecta as credenciais e ativa — e aí não acontece nada. A instância fica `active` esperando alguém que a execute.

O M2 constrói esse alguém. Passa a existir um motor que pega uma instância ativa, roda o agente dela, para para pedir aprovação humana antes de qualquer efeito no mundo, entrega o que foi aprovado item a item, e registra o que aconteceu.

Três coisas aqui têm consequência maior que o resto:

**A aprovação.** É a regra de segurança mais importante do sistema. Um e-mail errado enviado a 112 clientes não tem desfazer. A skill atual do escritório já funciona assim (monta relatório → para → só envia com "sim" explícito), e essa parada vira primitiva de plataforma, não disciplina de quem escreveu o agente.

**A entrega.** Mandar para 112 destinatários não é uma operação — são 112, cada uma com seu resultado. Uma falhar não pode derrubar as outras 111, e rodar de novo não pode reenviar o que já foi. Isso vale para qualquer agente que fale com gente, então é do runtime, não do agente (D40).

**A leitura de documento.** Conferir folha e DAS exige abrir o PDF e extrair vencimento, CNPJ e nome — de arquivos cujo layout muda de contador para contador. Isso não se sustenta em regex (D42). O modelo entra aqui como leitor, e junto dele entra a conta de quanto isso custa por rodada.

## Goals

- [ ] Uma instância ativa executa de verdade — disparada à mão ou por agendamento — e o que aconteceu fica registrado passo a passo
- [ ] Nenhum efeito externo acontece sem aprovação humana explícita daquela rodada; existe teste que falha se algum caminho conseguir enviar antes disso
- [ ] Um envio para muitos destinatários sobrevive a falha parcial e a nova execução: quem já recebeu não recebe duas vezes, quem falhou não impede os outros
- [ ] Um PDF vira dado estruturado e conferível, e o custo dessa leitura aparece no registro da execução
- [ ] O escritório vê no painel o que rodou, o que está esperando decisão e o que falhou

## Out of Scope

| Item | Motivo |
| --- | --- |
| Adapters reais de conector (Gmail, OneDrive, WhatsApp, Fortes Conecta) | Escopo do M3. O M2 executa contra adapters de teste que provam o contrato sem chamar fornecedor |
| Regras de negócio contábeis (categorias, quais documentos por cliente) | Escopo do M4. O M2 roda um agente de exercício que passa pelos mesmos caminhos, sem conhecer contabilidade |
| CRUD do cadastro de clientes (collection `customers`) | Escopo do M4 (D41). O M2 semeia dado por CLI/seed nos testes |
| Chat com agente | Spec própria, sem milestone |
| Limite de gasto por tenant | O M2 mede custo; barrar execução por orçamento é decisão de produto ainda não tomada |
| Retentativa automática de item falho em nova rodada | O M2 registra a falha e deixa a próxima rodada tentar naturalmente. Retentativa com backoff próprio é complexidade sem caso provado ainda |
| Streaming de log ao vivo no painel | O M2 entrega histórico e detalhe do run. Acompanhar em tempo real é conforto, não requisito do MVP |

---

## User Stories

### P1: Execução de uma instância, do gatilho ao registro ⭐ MVP

**User Story**: Como administrador de um tenant, quero disparar a execução de um serviço ativo e ver o que aconteceu, para saber que a automação rodou e o que ela fez.

**Why P1**: É o esqueleto do milestone. Sem run, fila e worker, nada mais do M2 tem onde acontecer.

**Acceptance Criteria**:

1. WHEN um gatilho dispara uma instância `active` THEN o sistema SHALL criar um `ServiceRun` com status `queued` e enfileirar um job contendo apenas ponteiros (`tenant_id`, `service_instance_id`, `run_id`, `trigger`)
2. WHEN o worker consome um job THEN o sistema SHALL estabelecer o contexto de tenant antes de qualquer leitura de dado de negócio
3. WHEN o gatilho aponta para uma instância que não está `active` THEN o sistema SHALL recusar criar o run, nomeando o status atual
4. WHEN a fila entrega o mesmo job duas vezes THEN o sistema SHALL reconhecer que aquele run já está em andamento ou concluído e não executar o agente de novo
5. WHEN um passo do agente termina THEN o sistema SHALL gravar um `RunStep` com o que foi feito e o resultado
6. WHEN o worker morre no meio de uma execução THEN o sistema SHALL deixar o run em estado recuperável, nunca preso em `running` para sempre
7. WHEN um job é montado THEN o sistema SHALL garantir que ele não carrega dado de negócio nem segredo — só ponteiros

**Independent Test**: Disparar pelo painel um agente de exercício numa instância ativa e ver o run aparecer, executar e registrar seus passos; matar o worker no meio e confirmar que o run não fica travado.

---

### P1: Agente como grafo, com checkpoint ⭐ MVP

**User Story**: Como plataforma, quero que o agente seja um grafo com estado salvo a cada passo, para que uma execução interrompida retome de onde parou em vez de recomeçar.

**Why P1**: É o que torna a aprovação possível. Sem checkpoint, parar para pedir decisão significaria refazer tudo depois do "sim" — e refazer inclui repetir efeitos já causados.

**Acceptance Criteria**:

1. WHEN o worker executa uma instância THEN o sistema SHALL montar o grafo declarado pelo agente e executá-lo com checkpoint persistido a cada passo
2. WHEN uma execução retoma de um checkpoint THEN o sistema SHALL continuar do passo seguinte, sem reexecutar passo já concluído
3. WHEN o grafo falha no meio THEN o sistema SHALL preservar o checkpoint do que já rodou, com o erro registrado no `RunStep` correspondente
4. WHEN um checkpoint é gravado THEN o sistema SHALL isolá-lo por tenant, como qualquer outro dado de tenant
5. WHEN um agente excede o tempo máximo de execução THEN o sistema SHALL encerrar o run como falho em vez de deixá-lo rodando indefinidamente

**Independent Test**: Rodar um agente de exercício de três passos, derrubar o processo depois do segundo, subir de novo e confirmar pelos `RunStep` que só o terceiro passo executou.

---

### P1: Aprovação humana antes de qualquer efeito externo ⭐ MVP

**User Story**: Como responsável pelo escritório, quero ver exatamente o que vai ser enviado antes de qualquer envio, e aprovar ou recusar, para que nada saia em meu nome sem eu ter visto.

**Why P1**: É a regra de segurança mais importante do sistema (D6). Envio errado não tem desfazer.

**Acceptance Criteria**:

1. WHEN o grafo pede aprovação THEN o sistema SHALL suspender a execução com checkpoint salvo, criar um `ApprovalRequest` com o que será feito, e colocar o run em `awaiting_approval`
2. WHEN um run está aguardando aprovação THEN o sistema SHALL garantir que nenhum efeito externo tenha acontecido até ali
3. WHEN um humano aprova THEN o sistema SHALL retomar a execução do checkpoint, registrando quem aprovou e quando
4. WHEN um humano recusa THEN o sistema SHALL encerrar o run sem executar o que estava pendente, registrando quem recusou
5. WHEN a mesma aprovação é decidida duas vezes THEN o sistema SHALL aceitar apenas a primeira decisão e recusar a segunda sem efeito
6. WHEN o usuário que decide não tem papel de escrita THEN o sistema SHALL recusar a decisão com erro de autorização
7. WHEN uma aprovação foi dada THEN o sistema SHALL restringi-la àquele pedido daquele run — nunca reaproveitada por outro run ou outra rodada
8. WHEN uma conexão necessária é revogada enquanto o run espera decisão THEN o sistema SHALL recusar retomar a execução, nomeando o que mudou

**Independent Test**: Rodar um agente que pede aprovação, confirmar pelo painel que nada foi entregue, aprovar, e ver o efeito acontecer só depois — e repetir recusando, confirmando que nada aconteceu.

---

### P1: Plano de entrega ⭐ MVP

**User Story**: Como responsável pelo escritório, quero disparar um envio para muitos clientes de uma vez e saber o resultado de cada um, para não descobrir depois que metade não recebeu.

**Why P1**: É a primitiva que sustenta o caso real do escritório — 30 e-mails, 2 pelo Fortes, 80 no WhatsApp numa rodada só (D40). E é o que o `ApprovalRequest` mostra ao humano.

**Acceptance Criteria**:

1. WHEN um agente produz um plano de entrega THEN o sistema SHALL tratá-lo como dado: uma lista de itens com destinatário, capability de entrega, mensagem, anexos e chave de idempotência
2. WHEN um plano é apresentado para aprovação THEN o sistema SHALL mostrar quantos itens vão por cada capability, sem agregar canais diferentes numa contagem só
3. WHEN um plano aprovado é executado THEN o sistema SHALL entregar cada item pela conexão vinculada à capability daquele item
4. WHEN a entrega de um item falha THEN o sistema SHALL registrar a falha daquele item e seguir com os demais
5. WHEN um plano é executado de novo com itens de mesma chave de idempotência THEN o sistema SHALL pular os itens já entregues com sucesso e tentar apenas os que não foram
6. WHEN um item é entregue THEN o sistema SHALL gravar o resultado dele como `RunStep` próprio, com sucesso ou motivo da falha
7. WHEN um plano é montado, aprovado, executado ou registrado THEN o sistema SHALL garantir que nenhum segredo de conexão aparece nele

**Independent Test**: Rodar um plano de exercício com dez itens onde três falham de propósito, confirmar que sete entregaram e que rodar de novo tenta só os três.

---

### P1: Leitura estruturada de documento ⭐ MVP

**User Story**: Como escritório, quero que o sistema abra o PDF do cliente e extraia vencimento, CNPJ e nome, para conferir se o documento é o certo antes de mandá-lo.

**Why P1**: É a checagem que a rotina inteira depende. Documento errado enviado ao cliente errado é o pior defeito possível deste produto (D42).

**Acceptance Criteria**:

1. WHEN um documento precisa ser lido THEN o sistema SHALL extrair o texto localmente e enviar apenas o texto ao modelo
2. WHEN a extração local não produz texto utilizável THEN o sistema SHALL renderizar a página e tentar a leitura por visão (D43)
3. WHEN o modelo responde THEN o sistema SHALL validar a resposta contra um esquema estrito e tratar resposta fora do formato como falha daquele documento, nunca da rodada inteira
4. WHEN uma leitura é feita THEN o sistema SHALL registrar tokens e custo no `RunStep` correspondente
5. WHEN o conteúdo do documento contém instruções endereçadas ao sistema THEN o sistema SHALL tratá-las como dado, nunca como comando
6. WHEN o modelo é chamado THEN o sistema SHALL garantir que nenhuma credencial de conector entra no prompt
7. WHEN o documento é lido THEN o sistema SHALL devolver o tipo do documento junto dos demais campos, para que a triagem não dependa do nome do arquivo

**Independent Test**: Ler um PDF digital de exercício e conferir os campos extraídos; repetir com um PDF que contém uma instrução maliciosa embutida e confirmar que o comportamento do sistema não muda.

---

### P2: Agendamento

**User Story**: Como escritório, quero que a rotina rode sozinha nos dias certos do mês, para não depender de alguém lembrar.

**Why P2**: O disparo manual já entrega valor e destrava a validação de tudo o mais. Agendar é o que torna a automação de fato automática, mas depende de o resto funcionar primeiro.

**Acceptance Criteria**:

1. WHEN um administrador define um agendamento numa instância THEN o sistema SHALL guardar a expressão de recorrência e o fuso horário do tenant
2. WHEN chega o momento agendado THEN o sistema SHALL disparar a execução do mesmo jeito que o gatilho manual dispara
3. WHEN a instância não está `active` no momento agendado THEN o sistema SHALL não disparar, registrando que pulou e por quê
4. WHEN o processo de agendamento fica fora do ar e volta THEN o sistema SHALL não disparar de uma vez todas as janelas perdidas
5. WHEN dois processos de agendamento rodam ao mesmo tempo THEN o sistema SHALL garantir um disparo por janela, não dois

**Independent Test**: Agendar uma instância para daqui a um minuto, confirmar que rodou uma vez só; pausar a instância e confirmar que a janela seguinte não disparou.

---

### P2: Histórico e diagnóstico de execução

**User Story**: Como escritório, quero abrir uma execução e ver o que aconteceu em cada passo, para entender o que falhou sem pedir ajuda a quem desenvolveu.

**Why P2**: O dado já existe desde a P1 (é o `RunStep`); esta story é a tela que o expõe. Vale menos que fazer a execução acontecer, mas sem ela o operador fica cego.

**Acceptance Criteria**:

1. WHEN o usuário abre uma instância THEN o sistema SHALL listar as execuções dela, da mais recente para a mais antiga, com status e horário
2. WHEN o usuário abre uma execução THEN o sistema SHALL mostrar seus passos na ordem, com resultado de cada um
3. WHEN uma execução envolveu entrega THEN o sistema SHALL mostrar o resultado por item, distinguindo entregue, falhou e pulado por já ter sido entregue
4. WHEN uma execução falhou THEN o sistema SHALL mostrar o motivo sem expor segredo, chave ou string de conexão
5. WHEN uma execução usou o modelo THEN o sistema SHALL mostrar o custo acumulado daquela execução

**Independent Test**: Rodar uma execução com sucesso e outra com falha, e confirmar pelo painel que dá para dizer o que aconteceu em cada uma sem consultar o banco.

---

## Edge Cases

| Situação | Comportamento esperado |
| --- | --- |
| Worker morre no meio da execução | Run volta a ser executável; o que já rodou está no checkpoint e não repete |
| Mesmo job entregue duas vezes pela fila | Segunda entrega não executa o agente de novo |
| Aprovação decidida duas vezes (duplo clique) | Primeira decisão vale; segunda é recusada sem efeito |
| Conexão revogada enquanto o run espera aprovação | Retomada recusada, nomeando o que mudou; run encerra sem entregar |
| Instância pausada enquanto o run espera aprovação | Mesma regra da conexão revogada — o gate é reavaliado na retomada, nunca assumido |
| Item de entrega falha por erro do fornecedor | Falha registrada naquele item; demais itens seguem |
| Rodada repetida no mesmo mês | Itens já entregues são pulados pela chave de idempotência |
| PDF sem camada de texto | Cai no caminho de visão; se ainda assim não der, vira "não verificável", nunca um palpite |
| PDF com instrução embutida tentando redirecionar o agente | Tratado como dado; nenhuma mudança de comportamento |
| Modelo devolve resposta fora do esquema | Aquele documento falha a validação; a rodada segue com os demais |
| Agente entra em laço e não termina | Encerrado por tempo máximo, run marcado como falho |
| Agendamento com o processo fora do ar por horas | Janelas perdidas não disparam em rajada ao voltar |

---

## Requirement Traceability

| ID | User Story | Origem | Status |
| --- | --- | --- | --- |
| RUN-01 | P1: Execução | Design §Fluxo de execução | Pendente |
| RUN-02 | P1: Execução | Design §Fluxo de execução (contexto de tenant) | Pendente |
| RUN-03 | P1: Execução | M1 (só instância ativa executa) | Pendente |
| RUN-04 | P1: Execução | Edge case: job duplicado | Pendente |
| RUN-05 | P1: Execução | Design §Modelo de dados (`RunStep`) | Pendente |
| RUN-06 | P1: Execução | Edge case: worker morre | Pendente |
| RUN-07 | P1: Execução | Design §Isolamento (job só com ponteiros) | Pendente |
| GRA-01 | P1: Grafo | Design D8 (LangGraph) | Pendente |
| GRA-02 | P1: Grafo | Design D6 (retomada do checkpoint) | Pendente |
| GRA-03 | P1: Grafo | Edge case: falha no meio | Pendente |
| GRA-04 | P1: Grafo | M0 (isolamento por tenant) | Pendente |
| GRA-05 | P1: Grafo | Edge case: agente em laço | Pendente |
| APR-01 | P1: Aprovação | Design D6 | Pendente |
| APR-02 | P1: Aprovação | Design D6 (invariante central) | Pendente |
| APR-03 | P1: Aprovação | Design D6 | Pendente |
| APR-04 | P1: Aprovação | Skill original (recusa encerra) | Pendente |
| APR-05 | P1: Aprovação | Edge case: dupla decisão | Pendente |
| APR-06 | P1: Aprovação | M1 (papéis) | Pendente |
| APR-07 | P1: Aprovação | Skill original ("aprovação vale só para a rodada") | Pendente |
| APR-08 | P1: Aprovação | M1 (revogação pausa instância) | Pendente |
| DEL-01 | P1: Entrega | D40 | Pendente |
| DEL-02 | P1: Entrega | Skill original (contagem por canal, nunca agregada) | Pendente |
| DEL-03 | P1: Entrega | D40 + M1 (bindings) | Pendente |
| DEL-04 | P1: Entrega | D40 (falha isolada por item) | Pendente |
| DEL-05 | P1: Entrega | Skill original (marcador `.enviado`) | Pendente |
| DEL-06 | P1: Entrega | D40 (auditoria por item) | Pendente |
| DEL-07 | P1: Entrega | M1 SEC-01 (segredo não vaza) | Pendente |
| DOC-01 | P1: Documento | D43 | Pendente |
| DOC-02 | P1: Documento | D43 (fallback por visão) | Pendente |
| DOC-03 | P1: Documento | D42 (saída estruturada é contrato) | Pendente |
| DOC-04 | P1: Documento | D7 (custo por passo) | Pendente |
| DOC-05 | P1: Documento | Design §Isolamento (prompt injection) | Pendente |
| DOC-06 | P1: Documento | Design §Isolamento (LLM não alcança credencial) | Pendente |
| DOC-07 | P1: Documento | D42 (triagem por conteúdo) | Pendente |
| SCH-01 | P2: Agendamento | Design §Modelo de dados (`Schedule`) | Pendente |
| SCH-02 | P2: Agendamento | Design §Fluxo de execução | Pendente |
| SCH-03 | P2: Agendamento | M1 (instância pausada não roda) | Pendente |
| SCH-04 | P2: Agendamento | Edge case: janelas perdidas | Pendente |
| SCH-05 | P2: Agendamento | Edge case: dois schedulers | Pendente |
| OBS-01 | P2: Histórico | Design §Componentes (observabilidade) | Pendente |
| OBS-02 | P2: Histórico | Design §Modelo de dados (`RunStep`) | Pendente |
| OBS-03 | P2: Histórico | D40 (resultado por item) | Pendente |
| OBS-04 | P2: Histórico | M0/M1 (erro sanitizado) | Pendente |
| OBS-05 | P2: Histórico | D7 (custo visível) | Pendente |

---

## Success Criteria

O M2 está pronto quando:

1. Um agente de exercício executa de ponta a ponta numa instância ativa, disparado pelo painel, e o histórico mostra cada passo
2. Existe teste que falha se qualquer caminho de código conseguir causar efeito externo antes da aprovação
3. Um plano de entrega com falha parcial entrega o que dá, registra o que falhou, e ao rodar de novo não reenvia o que já foi
4. Uma execução interrompida no meio retoma do checkpoint sem repetir passo
5. Um PDF vira dado estruturado conferível, e o custo da leitura aparece no run
6. Um PDF com instrução embutida não altera o comportamento do sistema
7. Um agendamento dispara uma vez por janela, e não dispara instância pausada
8. `pnpm check` verde

## Decisões tomadas nesta fase

| # | Decisão | Onde |
| --- | --- | --- |
| D40 | Entrega é primitiva do runtime, não serviço apartado | STATE.md |
| D41 | CRUD do cadastro de clientes fica no M4 | STATE.md |
| D42 | LLM é a forma de ler documento e está no caminho crítico | STATE.md |
| D43 | PDF por texto, com visão como exceção | STATE.md |
