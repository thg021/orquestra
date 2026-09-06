# M1 — Núcleo plugável: Especificação

**Milestone:** M1 — Núcleo plugável
**Status:** Especificado
**Data:** 2026-09-06

## Problem Statement

O M0 provou a fundação: o ambiente sobe, o usuário autentica e o banco recusa leitura entre tenants. Mas não existe nada para o tenant fazer depois de entrar — o painel é vazio por construção.

O M1 abre a plataforma. Passa a existir um catálogo do que pode ser plugado, um tenant consegue instalar um serviço, configurá-lo, e conectar as credenciais dos fornecedores que esse serviço vai precisar. Nada executa ainda: a execução é o M2 e os adapters reais são o M3. O que o M1 entrega é a estrutura onde essas peças encaixam — e, junto dela, a custódia de credencial de terceiros, que é a parte do sistema com maior consequência em caso de erro.

Construir o motor de execução antes disso significaria descobrir tarde que o modelo de configuração e de credencial não sustenta o que o runtime exige, com o custo de refazer o que já roda. E guardar credencial de cliente sem o cofre desenhado no ADR-001 é dívida que não se paga depois: uma vez que segredo em claro entra no banco, todo backup já feito continua vulnerável.

## Goals

- [ ] O tenant vê no painel o que existe para instalar, sem que nenhuma tela tenha sido escrita para um agente específico
- [ ] O tenant instala um serviço, preenche a configuração num formulário gerado a partir do próprio agente, e conecta as credenciais dos fornecedores
- [ ] Um serviço só ativa quando tudo o que ele exige está preenchido — e é o sistema que verifica, não a atenção de quem configurou
- [ ] Existe teste automatizado que falha se um segredo aparecer em resposta de API, em log ou em texto claro no banco

## Out of Scope

| Item | Motivo |
| --- | --- |
| Execução de agente, fila, worker, grafo | Escopo do M2; o M1 monta o que será executado, não o executor |
| Adapters funcionais de conector (Gmail, OneDrive, Fortes Conecta) | Escopo do M3; o M1 declara os conectores e guarda suas credenciais, sem chamar fornecedor algum |
| Fluxo OAuth (redirect, callback, refresh) | Adiado para o M3, junto do primeiro adapter que o consome. O modelo de dados nasce preparado, mas construir OAuth sem nada que use o token seria código sem prova |
| Verificação real de credencial contra o fornecedor | Depende de adapter. O contrato existe no M1 e responde `unverified` |
| CRUD das `data_collections` no painel | A definição já declara as coleções, mas o CRUD só tem uso quando houver execução consumindo os dados (M2/M4) |
| Agendamento (`Schedule`) | Escopo do M2 |
| Instalação de agente ou conector sem deploy (manifesto no banco) | Já registrado em STATE.md como ideia adiada |

---

## User Stories

### P1: Catálogo do que pode ser plugado ⭐ MVP

**User Story**: Como usuário de um tenant, quero ver a lista de agentes e conectores disponíveis, para saber o que posso instalar e do que vou precisar.

**Why P1**: É a porta de entrada de todo o milestone. Sem catálogo não há o que instalar, e é o catálogo que define o contrato que instância, configuração e binding consomem.

**Acceptance Criteria**:

1. WHEN o painel solicita o catálogo THEN o sistema SHALL devolver os agentes disponíveis com chave, versão, descrição, capabilities exigidas (marcando obrigatória ou opcional) e o esquema de configuração
2. WHEN o painel solicita o catálogo THEN o sistema SHALL devolver os conectores disponíveis com chave, capability satisfeita, tipo de adapter e esquema de autenticação, sem qualquer campo de segredo preenchido
3. WHEN a aplicação sobe THEN o sistema SHALL validar o catálogo inteiro e recusar iniciar se houver chave duplicada, versão fora do formato esperado, ou esquema não conversível em formulário
4. WHEN um agente declara uma capability que nenhum conector disponível satisfaz THEN o sistema SHALL recusar iniciar, nomeando a capability órfã
5. WHEN o catálogo é consultado THEN o sistema SHALL servi-lo a partir do código da aplicação, sem depender de registro em banco

**Independent Test**: Subir a API e obter, no painel, a lista de agentes e conectores com suas capabilities — e verificar que uma definição com capability órfã impede a subida.

---

### P1: Instalação e configuração de um serviço ⭐ MVP

**User Story**: Como administrador de um tenant, quero instalar um agente do catálogo e configurá-lo por um formulário, para preparar a automação do meu escritório sem depender de quem desenvolveu.

**Why P1**: É a entrega central do milestone — a `ServiceInstance` é a unidade em torno da qual todo o resto do sistema gira (D1).

**Acceptance Criteria**:

1. WHEN o usuário instala um agente do catálogo THEN o sistema SHALL criar uma instância vinculada ao tenant, fixando a chave e a versão do agente, com estado inicial `installed`
2. WHEN a configuração é enviada THEN o sistema SHALL validá-la contra o esquema da versão fixada e recusar a gravação de configuração inválida, indicando os campos com problema
3. WHEN o painel exibe a configuração de uma instância THEN a interface SHALL montar o formulário a partir do esquema do agente, sem tela escrita para aquele agente em particular
4. WHEN o usuário renomeia ou reconfigura uma instância THEN o sistema SHALL preservar as demais propriedades e o vínculo com o agente
5. WHEN o usuário remove uma instância THEN o sistema SHALL marcá-la como removida preservando o registro, em vez de apagá-la
6. WHEN uma instância removida é listada THEN o sistema SHALL omiti-la da listagem padrão do painel

**Independent Test**: Instalar o agente do catálogo, preencher o formulário gerado, salvar, recarregar a página e reencontrar a configuração.

---

### P1: Cofre de credenciais write-only ⭐ MVP

**User Story**: Como administrador de um tenant, quero cadastrar a credencial de um fornecedor uma única vez, para que a plataforma opere em meu nome sem que essa credencial fique legível para ninguém — nem para mim.

**Why P1**: É a parte do milestone com maior consequência em caso de erro, e a que o ADR-001 endereça. Toda credencial guardada em claro antes do cofre existir permanece vulnerável em todo backup já feito.

**Acceptance Criteria**:

1. WHEN uma credencial é cadastrada THEN o sistema SHALL cifrá-la antes de persistir, de forma que nenhum valor em texto claro chegue ao banco
2. WHEN uma credencial é cifrada THEN o sistema SHALL usar uma chave de dados própria daquela conexão, ela mesma cifrada por uma chave mestra derivada por tenant e mantida fora do banco
3. WHEN qualquer endpoint da API responde THEN o sistema SHALL omitir o valor do segredo, expondo apenas metadados — nome, fornecedor, data de criação, quatro últimos caracteres e estado
4. WHEN o usuário precisa alterar uma credencial THEN o sistema SHALL permitir substituí-la, sem oferecer caminho para visualizá-la
5. WHEN o esquema de autenticação de um conector distingue campo secreto de campo comum THEN o sistema SHALL cifrar apenas os secretos e guardar os demais legíveis, para que o painel possa exibi-los
6. WHEN ocorre erro em qualquer ponto do fluxo de credencial THEN o sistema SHALL sanitizar a mensagem antes de registrá-la, nunca incluindo o valor
7. WHEN a mesma credencial em texto claro é cadastrada por dois tenants diferentes THEN o sistema SHALL produzir cifras distintas, de forma que comprometer a chave de um tenant não alcance o outro

**Independent Test**: Cadastrar uma credencial conhecida, e verificar em teste que esse valor não aparece em nenhuma resposta da API, em nenhum log, e em nenhuma coluna do banco.

---

### P1: Vínculo de capability e gate de ativação ⭐ MVP

**User Story**: Como administrador de um tenant, quero indicar qual conexão atende cada necessidade do serviço, e ser impedido de ativá-lo enquanto faltar algo obrigatório, para não descobrir a falta durante uma execução.

**Why P1**: É o que transforma catálogo, instância e conexão num sistema. Sem o gate, a primeira execução do M2 falharia por configuração incompleta, e o diagnóstico aconteceria no pior momento possível.

**Acceptance Criteria**:

1. WHEN o usuário vincula uma conexão a uma capability de uma instância THEN o sistema SHALL aceitar apenas conexão cujo conector satisfaça aquela capability
2. WHEN uma capability já possui vínculo THEN o sistema SHALL substituí-lo, mantendo no máximo uma conexão por capability em cada instância
3. WHEN o usuário ativa uma instância THEN o sistema SHALL recusar a ativação se alguma capability obrigatória estiver sem vínculo, nomeando as que faltam
4. WHEN o usuário ativa uma instância THEN o sistema SHALL recusar a ativação se a configuração não for válida contra o esquema, ou se alguma conexão vinculada estiver revogada
5. WHEN todas as capabilities obrigatórias estão vinculadas e a configuração é válida THEN o sistema SHALL permitir a ativação mesmo com capabilities opcionais vazias
6. WHEN o usuário pausa uma instância ativa THEN o sistema SHALL preservar vínculos e configuração, permitindo reativar depois

**Independent Test**: Instalar um agente com uma capability obrigatória e uma opcional, tentar ativar sem vínculo algum (recusa nomeando a obrigatória), vincular só a obrigatória e ativar com sucesso.

---

### P2: Revogação e rotação de credencial

**User Story**: Como administrador de um tenant, quero revogar uma credencial comprometida imediatamente, para conter um incidente sem depender de reconfigurar os serviços que a usavam.

**Why P2**: Revogação só tem consequência real quando há execução acontecendo (M2). Mas a regra precisa nascer junto do cofre, porque define o comportamento do gate de ativação.

**Acceptance Criteria**:

1. WHEN o usuário revoga uma conexão THEN o sistema SHALL efetivá-la imediatamente, mesmo que serviços dependam dela — revogação nunca é bloqueada por dependência
2. WHEN uma conexão revogada deixa uma instância ativa sem capability obrigatória THEN o sistema SHALL pausar essa instância, registrando o motivo
3. WHEN uma credencial é substituída THEN o sistema SHALL preservar os vínculos existentes, sem exigir refazê-los
4. WHEN a chave mestra é rotacionada THEN o sistema SHALL recifrar apenas as chaves de dados, deixando os segredos intocados, e SHALL manter legíveis as conexões cifradas com a chave anterior durante a transição
5. WHEN uma conexão é persistida THEN o sistema SHALL registrar com qual versão de chave mestra ela foi cifrada

**Independent Test**: Revogar a conexão vinculada a uma capability obrigatória de uma instância ativa, e verificar que a instância passou a pausada com o motivo registrado.

---

### P2: Contrato de verificação de conexão

**User Story**: Como administrador de um tenant, quero ver se uma credencial está funcionando, para não descobrir que expirou apenas quando a automação falhar.

**Why P2**: A verificação real depende de adapter (M3). O que o M1 entrega é o contrato e o estado, para que o M3 acrescente a chamada sem alterar API nem painel.

**Acceptance Criteria**:

1. WHEN o usuário solicita a verificação de uma conexão THEN o sistema SHALL registrar o resultado e o momento da última verificação
2. WHEN não existe adapter capaz de verificar aquele conector THEN o sistema SHALL responder estado `unverified`, distinguindo-o de uma falha de credencial
3. WHEN o painel exibe uma conexão THEN a interface SHALL mostrar o estado da última verificação, incluindo o caso de nunca verificada

**Independent Test**: Solicitar verificação de uma conexão no M1 e obter `unverified`, com data registrada.

---

## Edge Cases

- WHEN uma instância fixa uma versão de agente que não existe mais no código THEN o sistema SHALL mantê-la legível e recusar sua ativação, nomeando a versão ausente, em vez de falhar ao listar
- WHEN o esquema de configuração de um agente muda entre versões THEN o sistema SHALL validar cada instância contra a versão que ela fixou, não contra a mais recente
- WHEN o usuário tenta vincular uma conexão de outro tenant THEN o sistema SHALL tratá-la como inexistente, sem revelar que existe
- WHEN duas conexões do mesmo tenant recebem o mesmo nome para o mesmo conector THEN o sistema SHALL recusar a segunda, para que o vínculo seja escolhido sem ambiguidade
- WHEN a chave mestra não está disponível na subida THEN o sistema SHALL falhar ao iniciar, em vez de subir e falhar apenas ao tocar uma credencial
- WHEN uma credencial é gravada e a transação falha depois THEN o sistema SHALL não deixar conexão parcialmente cifrada, tratando gravação de segredo e de metadados como uma unidade
- WHEN o esquema de configuração usa um construto fora do subconjunto suportado pelo formulário THEN o sistema SHALL recusar a definição na subida, em vez de renderizar um campo quebrado no painel
- WHEN uma instância é removida THEN o sistema SHALL preservar seus vínculos para auditoria, sem que ela volte a aparecer no painel
- WHEN um usuário com papel `operator` tenta criar conexão ou ativar instância THEN o sistema SHALL recusar com erro de autorização

---

## Requirement Traceability

| ID | História | Fase | Status |
| --- | --- | --- | --- |
| CAT-01 | P1: Catálogo | Design | Pendente |
| CAT-02 | P1: Catálogo | Design | Pendente |
| CAT-03 | P1: Catálogo | Design | Pendente |
| CAT-04 | P1: Catálogo | Design | Pendente |
| CAT-05 | P1: Catálogo | Design | Pendente |
| INST-01 | P1: Instalação e configuração | Design | Pendente |
| INST-02 | P1: Instalação e configuração | Design | Pendente |
| INST-03 | P1: Instalação e configuração | Design | Pendente |
| INST-04 | P1: Instalação e configuração | Design | Pendente |
| INST-05 | P1: Instalação e configuração | Design | Pendente |
| INST-06 | P1: Instalação e configuração | Design | Pendente |
| SEC-01 | P1: Cofre write-only | Design | Pendente |
| SEC-02 | P1: Cofre write-only | Design | Pendente |
| SEC-03 | P1: Cofre write-only | Design | Pendente |
| SEC-04 | P1: Cofre write-only | Design | Pendente |
| SEC-05 | P1: Cofre write-only | Design | Pendente |
| SEC-06 | P1: Cofre write-only | Design | Pendente |
| SEC-07 | P1: Cofre write-only | Design | Pendente |
| BIND-01 | P1: Vínculo e gate | Design | Pendente |
| BIND-02 | P1: Vínculo e gate | Design | Pendente |
| BIND-03 | P1: Vínculo e gate | Design | Pendente |
| BIND-04 | P1: Vínculo e gate | Design | Pendente |
| BIND-05 | P1: Vínculo e gate | Design | Pendente |
| BIND-06 | P1: Vínculo e gate | Design | Pendente |
| ROT-01 | P2: Revogação e rotação | Design | Pendente |
| ROT-02 | P2: Revogação e rotação | Design | Pendente |
| ROT-03 | P2: Revogação e rotação | Design | Pendente |
| ROT-04 | P2: Revogação e rotação | Design | Pendente |
| ROT-05 | P2: Revogação e rotação | Design | Pendente |
| CHK-01 | P2: Verificação de conexão | Design | Pendente |
| CHK-02 | P2: Verificação de conexão | Design | Pendente |
| CHK-03 | P2: Verificação de conexão | Design | Pendente |

**Cobertura:** 32 requisitos no total, 0 mapeados para tarefas ⚠️ (mapeamento ocorre na fase Tasks)

---

## Success Criteria

- [ ] O painel lista o catálogo real — o agente contábil e os seis conectores previstos — sem tela escrita para nenhum deles em particular
- [ ] O tenant piloto instala o agente, preenche a configuração no formulário gerado, e conecta credenciais
- [ ] Uma instância recusa ativar enquanto faltar capability obrigatória, e ativa quando só faltam as opcionais
- [ ] Teste de contenção de segredo verde: o valor cadastrado não aparece em resposta de API, log ou coluna do banco
- [ ] Rotação da chave mestra executada de ponta a ponta, com as conexões antigas continuando legíveis
- [ ] As três tabelas novas nascem cobertas pelo teste de introspecção de RLS herdado do M0

---

## Decisões tomadas nesta fase

| # | Decisão | Alternativa descartada e motivo |
| --- | --- | --- |
| 1 | Catálogo servido do código, sem tabela no banco | Sincronizar código para tabelas no boot: cria uma segunda fonte de verdade que diverge a cada mudança de versão, em troca de uma integridade referencial que a validação de subida já entrega |
| 2 | `config_schema` e `auth_schema` escritos em Zod, com JSON Schema derivado para o formulário | JSON Schema como fonte: obrigaria manter tipos TypeScript em paralelo, e o projeto já padronizou Zod em `packages/contracts` |
| 3 | Chave de dados aleatória por conexão, guardada cifrada | Chave derivada por função de derivação, sem persistir: mais enxuto, mas rotacionar a chave mestra exigiria recifrar todo segredo — a rotação não incremental que o ADR-001 recusou |
| 4 | OAuth adiado para o M3 | Implementar no M1: não há adapter que consuma o token, e um fluxo de autorização sem consumidor não tem como ser provado |
| 5 | Revogação nunca bloqueada; instâncias dependentes caem para pausada | Bloquear revogação enquanto houver serviço ativo: transformaria contenção de incidente em negociação de dependência |
| 6 | Renderizador de formulário próprio, sobre subconjunto documentado de esquema | Biblioteca de formulário-por-esquema: peso e aparência genérica desproporcionais ao punhado de tipos de campo que os nossos esquemas usam |
| 7 | Verificação de conexão declarada no M1, respondendo `unverified` | Deixar para o M3: o estado precisa existir no modelo e no painel desde o cadastro, senão o M3 mexeria em banco, API e interface para acrescentar uma chamada |
