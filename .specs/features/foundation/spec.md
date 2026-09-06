# M0 — Fundação: Especificação

**Milestone:** M0 — Fundação
**Status:** Especificado
**Data:** 2026-09-05

## Problem Statement

A Orquestra vai custodiar credenciais de terceiros e dados de negócio de múltiplos tenants na mesma base de dados. Antes de existir qualquer coisa plugável, é preciso que o alicerce esteja provado: um ambiente que sobe de forma reprodutível, um esquema com isolamento de tenant garantido pelo banco — não pela disciplina de quem escreve query — e um usuário que consegue autenticar e chegar a um painel sabendo em nome de qual tenant está agindo.

Construir catálogo, conectores ou execução antes disso significa escrever todo esse código sobre uma fundação de isolamento não verificada, e cada tabela nova multiplica o custo de corrigir depois.

## Goals

- [ ] Um desenvolvedor clona o repositório e sobe o sistema inteiro com um comando, sem instalar Postgres ou Redis na máquina
- [ ] Existe teste automatizado que falha se qualquer tabela de tenant permitir leitura entre tenants
- [ ] O operador cria um tenant e seu usuário owner por comando, e esse usuário consegue autenticar e ver o painel

## Out of Scope

| Item | Motivo |
| --- | --- |
| Cadastro self-service (signup público) | O segundo tenant real está fora do MVP; construir onboarding agora seria código sem usuário |
| Convite de usuários pelo painel | Depende de envio de e-mail, planejado apenas no M3 |
| Seletor de tenant na interface | O modelo suporta múltiplos vínculos, mas não há segundo tenant para justificar a tela |
| Recuperação de senha por e-mail | Mesma dependência de envio de e-mail; no M0 a redefinição é feita pelo operador via CLI |
| Catálogo, conectores, service instances, execução | Escopo de M1 e M2; o M0 não conhece nenhum desses conceitos |
| Deploy em produção, CI, HTTPS | O alvo do M0 é o ambiente de desenvolvimento; produção é tratada quando houver o que publicar |

---

## User Stories

### P1: Ambiente de desenvolvimento reproduzível ⭐ MVP

**User Story**: Como desenvolvedor, quero subir a plataforma inteira com um comando, para trabalhar sem instalar e versionar bancos na minha máquina.

**Why P1**: Todo o restante do trabalho depende de um ambiente que roda. Divergência de ambiente é a categoria de bug mais cara de diagnosticar num projeto de desenvolvedor único.

**Acceptance Criteria**:

1. WHEN o desenvolvedor executa o comando de subida THEN o sistema SHALL iniciar Postgres, Redis, a API e o frontend, com a API respondendo em um endpoint de saúde
2. WHEN a API sobe THEN o sistema SHALL aplicar as migrações pendentes antes de aceitar requisições
3. WHEN uma variável de ambiente obrigatória estiver ausente THEN o sistema SHALL falhar na inicialização com mensagem que nomeia a variável faltante, em vez de subir e falhar depois
4. WHEN o desenvolvedor executa o comando de verificação THEN o sistema SHALL rodar lint, typecheck e testes, retornando código de saída diferente de zero se qualquer um falhar

**Independent Test**: Em uma máquina limpa, clonar, copiar o arquivo de exemplo de ambiente, subir e obter resposta do endpoint de saúde.

---

### P1: Esquema versionado ⭐ MVP

**User Story**: Como desenvolvedor, quero que toda mudança de esquema seja uma migração versionada, para que o banco de qualquer ambiente seja reconstruível e auditável.

**Why P1**: RLS é configuração de esquema. Sem migração versionada, a política de isolamento vira estado manual de uma máquina — exatamente o que não pode acontecer com a garantia central de segurança.

**Acceptance Criteria**:

1. WHEN uma migração é aplicada THEN o sistema SHALL registrar sua identificação, impedindo reaplicação
2. WHEN as migrações são aplicadas em um banco vazio THEN o sistema SHALL produzir o esquema completo, incluindo as políticas de RLS
3. WHEN uma migração falha no meio THEN o sistema SHALL reverter a transação daquela migração, deixando o banco no estado anterior a ela

**Independent Test**: Destruir o volume do banco, subir de novo e verificar que o esquema e as políticas existem.

---

### P1: Isolamento de tenant garantido pelo banco ⭐ MVP

**User Story**: Como operador da plataforma, quero que o banco recuse leitura de dados de outro tenant mesmo diante de uma query mal escrita, para que uma falha de código não vire incidente de todos os clientes.

**Why P1**: É a garantia central do produto. Toda tabela criada depois herda essa convenção; estabelecê-la tarde significa reescrever tudo o que veio antes.

**Acceptance Criteria**:

1. WHEN uma tabela contém dados pertencentes a tenants THEN o sistema SHALL exigir coluna `tenant_id` e política de RLS ativada nela
2. WHEN uma consulta é executada com o contexto do tenant A estabelecido THEN o sistema SHALL retornar zero linhas de qualquer registro pertencente ao tenant B, mesmo que a consulta não filtre por `tenant_id`
3. WHEN uma escrita tenta gravar `tenant_id` diferente do contexto ativo THEN o sistema SHALL rejeitar a operação
4. WHEN uma operação de banco é executada sem contexto de tenant estabelecido THEN o sistema SHALL retornar zero linhas nas tabelas com RLS, em vez de retornar tudo
5. WHEN o contexto de tenant é estabelecido THEN o sistema SHALL fazê-lo com escopo de transação, de forma que o reuso da conexão pelo pool não carregue contexto de uma operação para a seguinte
6. WHEN uma tabela de tenant é criada sem política de RLS THEN o conjunto de testes SHALL falhar, apontando a tabela

**Independent Test**: Semear dois tenants com dados, e verificar em teste que, sob o contexto de cada um, apenas as próprias linhas são visíveis — e que sem contexto nada é visível.

---

### P1: Provisionamento de tenant e owner ⭐ MVP

**User Story**: Como operador da plataforma, quero criar um tenant e seu usuário owner por comando, para colocar o tenant piloto em operação sem construir telas de cadastro.

**Why P1**: Sem tenant e usuário não há como exercitar autenticação nem isolamento. É o menor caminho até um sistema utilizável.

**Acceptance Criteria**:

1. WHEN o operador executa o comando de provisionamento informando nome do tenant, e-mail e senha THEN o sistema SHALL criar o tenant, o usuário e um vínculo com papel `owner`
2. WHEN o e-mail informado já pertence a um usuário THEN o sistema SHALL vincular o usuário existente ao novo tenant em vez de criar duplicata
3. WHEN o comando é executado com o mesmo nome de tenant já existente THEN o sistema SHALL recusar a operação com mensagem explícita, em vez de criar um segundo tenant homônimo
4. WHEN o operador executa o comando de redefinição de senha informando o e-mail THEN o sistema SHALL substituir a senha do usuário

**Independent Test**: Rodar o comando, e em seguida autenticar na API com as credenciais informadas.

---

### P1: Autenticação por e-mail e senha ⭐ MVP

**User Story**: Como usuário de um tenant, quero entrar com e-mail e senha e permanecer autenticado, para acessar o painel do meu escritório.

**Why P1**: Sem sessão autenticada não há como estabelecer o contexto de tenant que a RLS exige. Autenticação é o que conecta identidade a isolamento.

**Acceptance Criteria**:

1. WHEN o usuário envia credenciais válidas THEN o sistema SHALL criar uma sessão e devolvê-la em cookie `httpOnly`, `secure` e `sameSite`
2. WHEN o usuário envia credenciais inválidas THEN o sistema SHALL responder com erro genérico, sem revelar se o e-mail existe
3. WHEN uma senha é armazenada THEN o sistema SHALL guardar apenas um hash com algoritmo de derivação lenta e sal por usuário, nunca a senha
4. WHEN uma requisição autenticada chega THEN o sistema SHALL resolver o tenant ativo a partir do vínculo do usuário e estabelecer o contexto de tenant antes de qualquer acesso a dados
5. WHEN o usuário solicita sair THEN o sistema SHALL invalidar a sessão no servidor, de modo que o cookie capturado deixe de funcionar
6. WHEN uma sessão ultrapassa seu prazo de validade THEN o sistema SHALL recusá-la e exigir nova autenticação
7. WHEN um usuário autenticado não possui vínculo com tenant algum THEN o sistema SHALL recusar o acesso em vez de conceder sessão sem contexto

**Independent Test**: Autenticar, acessar uma rota protegida, sair, e confirmar que a mesma rota passa a recusar.

---

### P1: Painel com shell autenticado ⭐ MVP

**User Story**: Como usuário de um tenant, quero uma interface que me deixe entrar, sair e ver em nome de qual tenant estou agindo, para ter onde as funcionalidades seguintes serão penduradas.

**Why P1**: É o critério de conclusão declarado do M0 — "login funcional, painel vazio". Também é o que prova que o contexto de tenant atravessa do banco até a tela.

**Acceptance Criteria**:

1. WHEN um visitante não autenticado acessa qualquer rota protegida THEN a interface SHALL redirecioná-lo para a tela de autenticação
2. WHEN o usuário autentica com sucesso THEN a interface SHALL exibir o shell com o nome do tenant ativo e o do usuário
3. WHEN a autenticação falha THEN a interface SHALL exibir mensagem de erro sem detalhar a causa
4. WHEN o usuário aciona sair THEN a interface SHALL encerrar a sessão e retornar à tela de autenticação
5. WHEN a sessão expira durante o uso THEN a interface SHALL levar o usuário à tela de autenticação em vez de exibir erro cru

**Independent Test**: Percorrer no navegador: acesso bloqueado, autenticação, shell com nome do tenant, saída.

---

### P2: Autorização por papel

**User Story**: Como owner de um tenant, quero que os papéis dos membros limitem o que cada um pode fazer, para que operação e administração sejam separadas.

**Why P2**: Os papéis precisam existir no modelo desde já, porque `operator` é quem decidirá aprovações no M2. Mas com um único usuário no tenant piloto, a aplicação fina das permissões não bloqueia nada no M0.

**Acceptance Criteria**:

1. WHEN um vínculo é criado THEN o sistema SHALL atribuir um papel entre `owner`, `admin` e `operator`
2. WHEN um usuário acessa um recurso que exige papel superior ao seu THEN o sistema SHALL recusar com erro de autorização, distinto do erro de autenticação
3. WHEN o último `owner` de um tenant seria removido ou rebaixado THEN o sistema SHALL recusar a operação

**Independent Test**: Criar vínculos de papéis diferentes e verificar aceitação e recusa em uma rota exemplo.

---

### P2: Proteção contra tentativa repetida de autenticação

**User Story**: Como operador da plataforma, quero limitar tentativas de autenticação, para que senhas não sejam descobertas por força bruta.

**Why P2**: O sistema não está exposto publicamente durante o M0, mas a proteção precisa existir antes de qualquer exposição — e é barata de acrescentar junto da autenticação.

**Acceptance Criteria**:

1. WHEN um mesmo e-mail acumula tentativas malsucedidas acima do limite dentro da janela THEN o sistema SHALL recusar novas tentativas temporariamente
2. WHEN o bloqueio temporário está ativo THEN o sistema SHALL responder da mesma forma para credencial correta e incorreta, sem revelar que a senha estava certa
3. WHEN uma autenticação é bem-sucedida THEN o sistema SHALL zerar o contador de tentativas daquele e-mail

**Independent Test**: Errar a senha acima do limite e verificar a recusa temporária, inclusive com a senha correta.

---

## Edge Cases

- WHEN o Postgres ainda não aceita conexões no momento em que a API sobe THEN o sistema SHALL aguardar e repetir antes de desistir, em vez de encerrar imediatamente
- WHEN duas migrações são disparadas simultaneamente THEN o sistema SHALL serializá-las por trava, aplicando cada uma uma única vez
- WHEN o e-mail informado no provisionamento tem diferença de caixa em relação a um existente THEN o sistema SHALL tratá-los como o mesmo usuário
- WHEN a senha informada no provisionamento é mais curta que o mínimo THEN o sistema SHALL recusar antes de criar qualquer registro
- WHEN o cookie de sessão é adulterado THEN o sistema SHALL tratá-lo como ausente
- WHEN um usuário é vinculado a mais de um tenant THEN o sistema SHALL eleger determinísticamente um tenant ativo (o vínculo mais antigo), já que não há seletor na interface
- WHEN um tenant é criado THEN o sistema SHALL registrar `tenant_id` como identificador não sequencial, para que enumerar identificadores não revele o número de clientes
- WHEN a aplicação se conecta ao banco THEN o sistema SHALL fazê-lo com usuário sem privilégio de contornar RLS, porque políticas não se aplicam ao proprietário da tabela nem a superusuário

---

## Requirement Traceability

| ID | História | Fase | Status |
| --- | --- | --- | --- |
| ENV-01 | P1: Ambiente reproduzível | Design | Pendente |
| ENV-02 | P1: Ambiente reproduzível | Design | Pendente |
| ENV-03 | P1: Ambiente reproduzível | Design | Pendente |
| ENV-04 | P1: Ambiente reproduzível | Design | Pendente |
| DATA-01 | P1: Esquema versionado | Design | Pendente |
| DATA-02 | P1: Esquema versionado | Design | Pendente |
| DATA-03 | P1: Esquema versionado | Design | Pendente |
| RLS-01 | P1: Isolamento de tenant | Design | Pendente |
| RLS-02 | P1: Isolamento de tenant | Design | Pendente |
| RLS-03 | P1: Isolamento de tenant | Design | Pendente |
| RLS-04 | P1: Isolamento de tenant | Design | Pendente |
| RLS-05 | P1: Isolamento de tenant | Design | Pendente |
| RLS-06 | P1: Isolamento de tenant | Design | Pendente |
| TNT-01 | P1: Provisionamento | Design | Pendente |
| TNT-02 | P1: Provisionamento | Design | Pendente |
| TNT-03 | P1: Provisionamento | Design | Pendente |
| TNT-04 | P1: Provisionamento | Design | Pendente |
| AUTH-01 | P1: Autenticação | Design | Pendente |
| AUTH-02 | P1: Autenticação | Design | Pendente |
| AUTH-03 | P1: Autenticação | Design | Pendente |
| AUTH-04 | P1: Autenticação | Design | Pendente |
| AUTH-05 | P1: Autenticação | Design | Pendente |
| AUTH-06 | P1: Autenticação | Design | Pendente |
| AUTH-07 | P1: Autenticação | Design | Pendente |
| SHELL-01 | P1: Painel autenticado | Design | Pendente |
| SHELL-02 | P1: Painel autenticado | Design | Pendente |
| SHELL-03 | P1: Painel autenticado | Design | Pendente |
| SHELL-04 | P1: Painel autenticado | Design | Pendente |
| SHELL-05 | P1: Painel autenticado | Design | Pendente |
| ROLE-01 | P2: Autorização por papel | — | Pendente |
| ROLE-02 | P2: Autorização por papel | — | Pendente |
| ROLE-03 | P2: Autorização por papel | — | Pendente |
| RATE-01 | P2: Proteção contra força bruta | — | Pendente |
| RATE-02 | P2: Proteção contra força bruta | — | Pendente |
| RATE-03 | P2: Proteção contra força bruta | — | Pendente |

**Cobertura:** 34 requisitos no total, 0 mapeados para tarefas ⚠️ (mapeamento ocorre na fase Tasks)

---

## Success Criteria

- [ ] Em máquina limpa, do clone ao endpoint de saúde respondendo com um comando
- [ ] Teste de isolamento verde, cobrindo: leitura entre tenants bloqueada, escrita cruzada recusada, e ausência de contexto retornando vazio
- [ ] Teste que falha automaticamente se uma tabela de tenant for criada sem RLS
- [ ] Tenant piloto e usuário owner criados por comando, autenticando no painel e vendo o nome do tenant
- [ ] Lint, typecheck e testes rodando em um comando único, com saída diferente de zero em caso de falha
- [ ] Nenhuma senha ou segredo em texto claro no banco, em log ou em resposta da API

---

## Decisões tomadas nesta fase

| # | Decisão | Alternativa descartada e motivo |
| --- | --- | --- |
| 1 | Autenticação por e-mail e senha com sessão em cookie `httpOnly` | Magic link e OAuth Google: ambos exigiriam infraestrutura externa (envio de e-mail ou provedor de identidade) já na fundação, sendo que envio de e-mail só está planejado para o M3 |
| 2 | Tenant e owner provisionados por CLI do operador | Cadastro self-service: o segundo tenant real está fora do MVP, e onboarding público sem usuário seria código especulativo |
| 3 | `Membership` como vínculo muitos-para-muitos, sem seletor de tenant na interface | `tenant_id` direto no usuário: simplifica agora, mas é caro reverter quando um contador atender dois escritórios |
| 4 | Sessão com estado no servidor | JWT sem estado: invalidação imediata no logout é requisito (AUTH-05), e token sem estado só expira |
