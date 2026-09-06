# ADR-001: Gestão de segredos de conectores via envelope encryption

- **Data**: 2026-09-05
- **Status**: Aceito
- **Decisores**: Thiago (operador da plataforma)
- **Tags**: segurança, criptografia, multitenancy, agentes

## Contexto e problema

A Orquestra é uma plataforma multitenant de automação com agentes. Cada tenant conecta serviços de terceiros — Gmail, OneDrive via Microsoft Graph, WhatsApp via MCP, Fortes Conecta via API REST — e essas conexões exigem credenciais de longa duração (refresh tokens OAuth e API keys) armazenadas pela plataforma, porque as automações rodam de forma agendada e sem ninguém presente.

Três forças tornam isso mais crítico do que armazenamento de segredo convencional:

1. **Multitenancy com banco compartilhado.** As credenciais de todos os tenants convivem nas mesmas tabelas. Um comprometimento indiscriminado seria um incidente de todos os clientes simultaneamente.
2. **O executor é um LLM.** O agente é dirigido por um modelo que lê conteúdo não confiável — corpo de e-mail, PDF enviado por cliente. Prompt injection é um vetor real: se a credencial for alcançável pelo modelo, um documento malicioso pode induzi-lo a exfiltrá-la. Isso não existe em aplicações convencionais.
3. **O MVP roda em Docker Compose em host único**, sem KMS gerenciado disponível, mas a solução não pode inviabilizar a migração para um depois.

## Decisores da escolha

- Vazamento do banco (backup, réplica, SQL injection) não pode expor credencial alguma
- O LLM não pode alcançar credenciais em nenhuma circunstância
- Rotação e revogação precisam ser possíveis sem downtime e sem recriar configurações
- A migração para KMS/Vault não pode exigir reescrita da aplicação
- Operável por um desenvolvedor único, sem infraestrutura dedicada

## Opções consideradas

- Envelope encryption com KEK fora do banco
- Chave de criptografia única e global para todos os segredos
- Texto claro no banco, com proteção apenas por controle de acesso
- Delegar todo o armazenamento a um Vault externo já no MVP

## Decisão

Escolhemos **envelope encryption com KEK fora do banco**.

Cada conexão tem uma DEK própria, derivada por tenant, que cifra o segredo com AES-256-GCM. A DEK é cifrada por uma KEK que nunca reside no banco — no MVP entregue como Docker secret montado em arquivo (e não variável de ambiente, que vaza em `docker inspect` e em dumps de processo). O ciphertext carrega versão de chave, permitindo rotação incremental sem quebrar execuções em andamento.

Três regras acompanham a decisão e são tão determinantes quanto a criptografia:

- **Write-only na API.** Não existe endpoint que retorne um segredo. O painel exibe apenas metadados — últimos quatro caracteres, data de criação, status da última chamada. Editar é substituir, nunca visualizar.
- **Isolamento estrutural do LLM.** O modelo decide *o quê* fazer; o adapter detém a credencial e executa. O modelo emite `send_email(to, subject, body)` e jamais recebe, vê ou consegue solicitar o token. Segredo não entra em prompt, payload de job, log, `RunStep` ou mensagem de erro — erros de autenticação do fornecedor são sanitizados antes de virar log.
- **Auditoria de uso sem o valor.** Toda utilização registra qual conexão, em qual execução, com qual resultado. Nunca o segredo.

Preferimos OAuth a API key sempre que o fornecedor oferecer, porque o escopo é limitado, a revogação é possível do lado do fornecedor e o usuário não digita credencial em formulário.

### Consequências positivas

- Vazamento do banco não entrega segredo algum sem a KEK
- Comprometer a chave de um tenant não abre os demais
- A migração para KMS/Vault altera apenas quem resolve a KEK; o restante do sistema não percebe
- A regra write-only elimina toda uma classe de vazamento — XSS, screenshot, log de navegador, sessão sequestrada
- Rotação de chave sem downtime graças ao versionamento do ciphertext

### Consequências negativas

- Perder a KEK torna todos os segredos irrecuperáveis; backup e custódia da KEK passam a ser procedimento operacional crítico
- Toda chamada a conector paga o custo de uma decifragem
- A ausência de leitura de segredo é atrito real de usabilidade: quem esquecer uma API key precisa gerá-la de novo no fornecedor
- Docker secret em host único é mais fraco que um KMS gerenciado — é dívida consciente, não solução final
- A disciplina de nunca expor segredo ao LLM precisa ser sustentada em cada adapter novo, e por isso deve ser coberta por teste, não por revisão manual

## Prós e contras das opções

### Envelope encryption com KEK fora do banco ✅ Escolhida

- ✅ Banco vazado é inútil sem a KEK
- ✅ Isolamento entre tenants por derivação de chave
- ✅ Rotação incremental viável
- ✅ Caminho de migração para KMS sem reescrita
- ❌ Custódia da KEK vira responsabilidade operacional crítica
- ❌ Mais complexo que cifrar com uma chave só

### Chave única e global

- ✅ Implementação trivial
- ❌ Uma chave comprometida abre todos os tenants de uma vez
- ❌ Rotação exige reescrever todos os segredos simultaneamente
- ❌ Não oferece caminho natural para KMS

### Texto claro com controle de acesso

- ✅ Nenhuma complexidade de implementação
- ❌ Qualquer backup, réplica ou SQL injection entrega todas as credenciais dos clientes
- ❌ Incompatível com custódia de credencial de terceiros

### Vault externo já no MVP

- ✅ Solução madura, com rotação e auditoria prontas
- ✅ Custódia de chave deixa de ser problema nosso
- ❌ Mais um serviço para operar e manter em ambiente de desenvolvedor único
- ❌ Atrasa o MVP sem reduzir risco proporcionalmente, dado um tenant piloto
- ❌ A decisão por envelope encryption não impede adotá-lo depois — só a resolução da KEK muda

## Links

- Design da plataforma: [`docs/specs/2026-09-05-orquestra-design.md`](../specs/2026-09-05-orquestra-design.md)
- Aplica-se às entidades `ConnectorConnection` e `ConnectorBinding` (Service Management)
