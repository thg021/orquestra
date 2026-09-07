# Princípios de código

**Data:** 2026-09-06
**Status:** normativo para todos os milestones

Este documento não é uma lista de boas práticas de livro. Cada princípio aqui existe porque uma decisão real da Orquestra o exigiu, e cada um aponta o arquivo onde ele vive. Se um princípio não puder ser apontado no código ou numa decisão registrada, ele não entra aqui.

Como ler cada bloco:

```
  o princípio   ->  uma frase
  onde aparece  ->  caminho de arquivo real
  se violar     ->  o que quebra, e quem avisa
```

---

## 1. `core`, `db` e `catalog` não conhecem framework

**O princípio.** Domínio, persistência e declaração de catálogo são código puro de TypeScript. Não importam NestJS. `catalog` também não importa `db`.

**Onde aparece.**

| Arquivo | O que faz |
| --- | --- |
| `eslint.config.mjs` | regra `no-restricted-imports` bloqueia `@nestjs/*` em `packages/core`, `packages/db` e `packages/catalog` |
| `packages/catalog/test/boundaries.unit.test.ts` | lê os fontes do pacote e falha se achar `from "@nestjs/` ou `from "@orquestra/db` |
| `CLAUDE.md` §Convenções | a regra de dependência escrita: `web → contracts`, `api → contracts, core, db`, `db → core`, `core → nada` |

A razão é concreta, não estética: `packages/catalog` precisa ser carregável pela API, pelo worker do M2 e por um teste unitário que não sobe nada. Se ele importar o NestJS, todo teste unitário passa a arrastar o container de injeção junto.

**Se violar.** Duas redes pegam. O `pnpm lint` reprova pelo ESLint. O teste de fronteira do `catalog` reprova mesmo que alguém relaxe a regra de lint — ele lê o texto do arquivo. Nenhuma das duas se conserta desligando a rede; conserta-se movendo o código para `apps/api`.

---

## 2. Seis bounded contexts, e cada um dono do seu

**Bounded context** é um pedaço do sistema com vocabulário próprio e dono próprio. A mesma palavra pode significar coisas diferentes em dois contextos, e tudo bem — o que não pode é um mexer na tabela do outro.

A Orquestra tem seis (design §4):

```
  Identity & Access   Tenant, User, Membership
        |
        v  (todo o resto pendura no tenant)
  Catalog             AgentDefinition, ConnectorDefinition     <- código do operador
        |
        v
  Service Management  ServiceInstance, ConnectorConnection, ConnectorBinding
        |
        +-----------------------+
        v                       v
  Scheduling                Execution               Service Data
  Schedule                  ServiceRun,             ServiceRecord
                            RunStep,
                            ApprovalRequest
```

**A regra de quem fala com quem.**

| Contexto | Possui | Pode ler | Nunca |
| --- | --- | --- | --- |
| Identity & Access | tenant, usuário, papel | — | conhecer serviço ou execução |
| Catalog | definições de agente e conector | — | tocar em dado de tenant (não tem `tenant_id` nenhum) |
| Service Management | instância, conexão, binding | Catalog, Identity | executar coisa alguma |
| Scheduling | `Schedule` | Service Management | rodar o grafo — só enfileira |
| Execution | run, step, aprovação | Service Management (por id) | escrever em `ServiceRecord` de outra instância |
| Service Data | `ServiceRecord` | — | ser lido fora da instância dona |

Duas consequências que já estão no código:

- **Catalog não tem tabela** (D22). O catálogo é servido do código, em `packages/catalog`. Uma fonte de verdade só. O preço é que não existe integridade referencial do banco entre instância e definição — quem substitui isso é a validação no boot (`validateCatalog`), que derruba o processo em vez de deixar o erro aparecer na cara do usuário. Veja `packages/catalog/src/errors.ts`.
- **`ServiceRecord` é isolado por instância, não só por tenant** (`packages/db/src/schema/service-data.ts`). Dois serviços do mesmo escritório não enxergam o dado um do outro. É o que a D1 comprou ao eleger `ServiceInstance` como unidade central.

**Se violar.** Um contexto que escreve na tabela de outro é a forma mais barata de fazer o monólito modular virar um monólito e ponto. E aí a D3 (separar em serviços é reversível a partir daqui) deixa de valer.

---

## 3. Linguagem ubíqua: inglês no código, português na tela

**Linguagem ubíqua** é usar a mesma palavra no negócio, na conversa e no código — sem tradução no meio.

A decisão D12 divide onde cada idioma manda:

| Onde | Idioma | Exemplo real |
| --- | --- | --- |
| identificador, tipo, função | inglês | `ServiceInstance`, `ConnectorBinding`, `hasAtLeast` |
| nome de tabela e de coluna | inglês | `service_records`, `tenant_id` |
| chave de catálogo e de coleção | inglês | `accounting-routine`, `customers`, `file-storage` |
| texto que o usuário lê | português | `"Você não tem permissão para esta ação."` |
| comentário e documento | português | este arquivo, e todo `.specs/` |

**O efeito prático.** Não existe dicionário mental entre a conversa e o código. Quando o design fala em `ConnectorBinding`, a classe se chama `ConnectorBinding` — não `VinculoDeConector`. E quando você lê `capability` num comentário em português, é a mesma `capability` do `packages/catalog/src/capabilities.ts`.

O efeito segundo é mais útil ainda: **como o código é inglês, qualquer string em português dentro dele é suspeita de ser texto de usuário no lugar errado.** Texto de usuário mora na borda (`apps/api/src/common/error.filter.ts`), não no domínio.

**Se violar.** Nome em português no código vira sinônimo. Sinônimo vira duas coisas com o mesmo significado e comportamentos diferentes, e ninguém percebe até alguém procurar por `binding` e não achar metade.

---

## 4. Domínio puro é o que dá para testar sem banco

**Função pura** é a que só depende dos argumentos: sem banco, sem rede, sem relógio, sem arquivo. Mesma entrada, mesma saída, sempre.

**Onde aparece.** O exemplo canônico do projeto é o **gate de ativação** do M1 (D28, design do M1 §Componentes):

```
  ActivationGate.evaluate(instance, bindings, catalog) -> GateResult

    definição da versão fixada existe?         -> AGENT_VERSION_MISSING
    config válida contra o schema da versão?   -> CONFIG_INVALID
    toda capability obrigatória tem binding?   -> CAPABILITY_UNBOUND
    toda conexão vinculada está active?        -> CONNECTION_REVOKED
```

Ele não é puro por elegância. É puro porque **o worker do M2 precisa reavaliá-lo antes de cada execução**. Uma função sem I/O roda igual na API e no worker. Uma que carrega o próprio dado do banco viraria duas implementações que divergem no primeiro bug.

Outros exemplos já no código:

| Arquivo | Por que é puro |
| --- | --- |
| `packages/core/src/roles.ts` | `hasAtLeast(role, required)` é uma tabela de precedência e uma comparação |
| `packages/core/src/id.ts` | `newId()` é o único que guarda estado (monotonicidade do UUID v7), e por isso é o único que precisa de teste de sequência |
| `packages/catalog/src/define.ts` | valida a definição na hora da chamada; definição malformada não chega a existir como objeto |

A matriz de `.specs/codebase/TESTING.md` já formaliza isso: código em `packages/core/**` tem tipo de teste `unit`, "sem I/O; teste rápido e determinístico".

**Se violar.** Uma regra de negócio que precisa de banco para ser testada será testada menos vezes, mais devagar, e com fixture. A matriz de casos do gate (obrigatória faltando, opcional faltando, config inválida, conexão revogada, versão ausente, caminho feliz) tem seis linhas — se cada uma exigisse um Testcontainers, alguém cortaria três.

---

## 5. Erro de domínio tem código estável; a tradução é na borda

**O princípio.** O domínio lança um erro com um `code` que não muda. Quem transforma isso em status HTTP e em frase para o usuário é uma camada só, na saída.

**Onde aparece.**

```
  packages/core/src/errors.ts          DomainError { code, message }
        |                              InvalidCredentialsError -> "INVALID_CREDENTIALS"
        |
        v
  apps/api/src/common/error.filter.ts  code -> HttpStatus  +  code -> texto pt-BR
        |
        v
  packages/contracts/src/error.ts      { code, message } que o painel recebe
```

`packages/catalog/src/errors.ts` estende o mesmo `DomainError` com `CATALOG_DEFINITION_INVALID`. O catálogo é outro contexto, mas o mecanismo de erro é o mesmo.

Duas regras acompanham:

- **Nada de mensagem crua vazando.** O `ErrorFilter` tem um `@Catch()` sem argumento: exceção não mapeada vira sempre `INTERNAL_ERROR` com "Erro interno do servidor.", e o detalhe só vai para o log do servidor.
- **Log nunca carrega segredo.** É regra explícita do `CLAUDE.md`: nenhuma mensagem de erro ou log leva senha, token, chave ou string de conexão. Erro de driver é limpo antes de virar log.

**Se violar.** Se o painel passar a decidir a mensagem pelo `message` em vez do `code`, qualquer ajuste de texto no servidor quebra a tela. E se um erro novo não passar pelo filtro, o cliente recebe stack trace — que é o caminho conhecido para vazar nome de tabela e string de conexão.

---

## 6. Teste primeiro, e visto falhando

**Como se pratica aqui.** O ciclo está no `CLAUDE.md`:

```
  leio a task -> escrevo o teste -> vejo falhar -> faço passar -> pnpm check -> commit
```

Três regras que dão dente a isso:

1. **Se a task não diz como testar, pergunta-se antes de escrever código.**
2. **Co-locação:** a task que cria ou altera uma camada escreve o teste daquela camada na mesma task. "Será testado em outra task" não é justificativa aceita (`TESTING.md`).
3. **O tipo de teste não é escolha:** a Test Coverage Matrix do `TESTING.md` diz qual camada exige `unit`, `integration` ou `e2e`. RLS não é simulável com banco em memória — quem toca policy roda contra Postgres real, via Testcontainers.

**Testes-guarda.** Quatro testes do projeto não são testes comuns. Existem para impedir uma classe inteira de regressão, e nenhum milestone pode desativá-los (`TESTING.md` §Testes que são gate de segurança):

| Guarda | Onde | O que protege |
| --- | --- | --- |
| Isolamento entre tenants | `packages/db/test/tenant-context.int.test.ts` | escritório A não vê linha de B |
| Cobertura de RLS por introspecção | `packages/db/test/rls-coverage.int.test.ts` | tabela nova com `tenant_id` sem policy quebra o build |
| Vazamento de contexto pelo pool | `packages/db/test/tenant-context.int.test.ts` | pool com `max: 1` alternando tenants |
| Contenção de segredo (a partir do M1) | M1 | valor de credencial aparecendo em prompt, job, `RunStep`, log ou resposta |

**Um teste-guarda precisa ser provado quebrando de propósito.** Um teste que passa por acidente — porque a introspecção não achou nada, porque o loop não iterou — é pior que não ter teste, porque dá confiança falsa. Antes de considerar um guarda pronto: quebre a propriedade de propósito (crie a tabela sem RLS, tire o `FORCE`), veja o teste vermelho, desfaça.

O `rls-coverage.int.test.ts` mostra como isso se sustenta ao longo do tempo: ele tem uma lista explícita de isenções (`memberships`, `sessions`), com o motivo escrito em comentário. Isentar é um ato consciente e documentado, não um `skip`.

**Se violar.** O `CLAUDE.md` é direto: "Não desligue esse teste — conserte a tabela."

---

## 7. Segurança é estrutura, não disciplina

**O princípio.** Uma propriedade de segurança que depende de alguém lembrar não é uma propriedade. Tem que ser imposta por algo que não esquece.

Três aplicações, todas já decididas:

**(a) O isolamento entre escritórios é do Postgres, não da query** (D2, D19).

```
  o desenvolvedor esquece o WHERE tenant_id = ...
        |
        v
  RLS avalia a policy sobre app.tenant_id
        |
        v
  resultado: zero linhas       (não: linhas do escritório errado)
```

Onde vive: `packages/db/src/tenant-context.ts`. Existe um caminho só para o banco — `withTenant` (abre transação e faz `set_config('app.tenant_id', $1, true)`) ou `withoutTenant` (tabelas globais). Uma regra de lint garante que não existe atalho para o pool. O papel `orquestra_app` é `NOBYPASSRLS`, e as tabelas têm `FORCE ROW LEVEL SECURITY` — nem o dono escapa.

O `true` do `set_config` é local à transação. Por isso o pooling não vaza contexto entre jobs. E a policy usa `nullif(current_setting('app.tenant_id', true), '')::uuid` — sem o `nullif`, uma conexão reaproveitada devolve `''` em vez de `NULL` e a policy quebra em vez de filtrar (lição da T5).

**(b) O LLM não alcança o segredo por construção** (ADR-001, D8).

O agente lê conteúdo não confiável: corpo de e-mail, PDF que o cliente mandou. Prompt injection é vetor real. A defesa não é instruir o modelo a não vazar credencial — é o modelo não ter credencial nenhuma para vazar:

```
  LLM decide O QUÊ       send_email(to, subject, body)
        |
        v
  adapter detém o segredo e EXECUTA
```

Segredo não entra em prompt, payload de job, log, `RunStep` nem mensagem de erro. O job carrega só ponteiros: `{ tenant_id, service_instance_id, run_id, trigger }`. Não existe endpoint que devolva um segredo — editar é substituir, nunca visualizar.

**(c) O que é segredo é marcado, não deduzido pelo nome.** `packages/catalog/src/secret.ts` marca o campo com metadado do Zod (`.meta({ secret: true })`), e o comentário do próprio arquivo diz por quê: deduzir pelo nome — "tudo que chama key ou token é segredo" — é onde esse tipo de erro nasce. Marcado é explícito, verificável por teste, e atravessa a conversão para JSON Schema intacto.

**Se violar.** O ADR-001 já registrou o custo: "a disciplina de nunca expor segredo ao LLM precisa ser sustentada em cada adapter novo, e por isso deve ser coberta por teste, não por revisão manual". Adapter novo sem teste de contenção de segredo é adapter que não entra.

---

## 8. Nome diz o que é; arquivo grande é sintoma

**O princípio.** O nome carrega a intenção. O tamanho do arquivo é o termômetro — arquivo que cresce demais quase sempre está fazendo coisa demais.

**Onde aparece.** Hoje nenhum arquivo de produção do repositório passa de ~165 linhas. Os maiores:

| Arquivo | Linhas | Faz uma coisa? |
| --- | --- | --- |
| `packages/catalog/src/define.ts` | 163 | sim — declarar e validar definição de catálogo |
| `apps/api/src/identity/identity.repository.ts` | 141 | sim — acesso a dados de identidade |
| `apps/api/src/auth/session.repository.ts` | 103 | sim |
| `apps/api/src/common/error.filter.ts` | 96 | sim — o único ponto de tradução erro → HTTP |

Não há número mágico. O sinal é este: **quando você não consegue nomear o arquivo sem usar "e", ele virou dois arquivos.** Um `service.ts` que autentica *e* envia e-mail *e* formata resposta é três.

O sufixo já diz o papel, e a matriz de testes do `TESTING.md` usa isso: `*.repository.ts` é integração, `*.controller.ts` e `*.guard.ts` são e2e, `packages/core/**` é unit. Nome errado leva ao tipo de teste errado.

**Se violar.** Nada quebra o build. Quebra na revisão, e depois quando o arquivo precisa mudar por duas razões diferentes ao mesmo tempo.

---

## 9. Adiar é uma decisão, e ela é registrada

**YAGNI** ("you aren't gonna need it"): não construa hoje o que só o futuro pode pedir. Aqui isso não é preguiça — é decisão escrita, com data e critério.

**O critério usado.** Uma coisa é adiada quando as três valem:

```
  1. adiar não fecha nenhuma porta        (a estrutura já comporta)
  2. o que aprendemos ao construir agora
     é menor do que aprenderíamos depois  (falta o consumidor real)
  3. o MVP entrega valor sem isso
```

**Casos reais.**

| Adiado | Para quando | Por quê, pelo critério |
| --- | --- | --- |
| Fluxo OAuth (D26) | M3 | Vai junto do primeiro adapter que consome o token. Sem o consumidor, seria OAuth escrito contra imaginação. O M1 entrega credencial por formulário e o **modelo de dados já preparado** — porta aberta. |
| Chat com agentes (D11) | pós-MVP, spec próprio | É superfície de interação com desenho próprio. Metê-lo no MVP misturaria dois problemas. |
| Marketplace de terceiros (design §2) | — | Todo agente e conector é código do operador. Sem código de terceiro, **não é preciso sandboxing** — uma complexidade inteira que some. |
| Segundo tenant real (design §2) | — | A arquitetura suporta; provar com um tenant valida o modelo. |
| Kubernetes (design §2) | — | O alvo é Docker Compose em host único. |
| Vault externo (ADR-001) | depois | "A decisão por envelope encryption não impede adotá-lo depois — só a resolução da KEK muda." Porta aberta, explicitamente. |
| Banco por tenant (D2) | se um plano exigir | "A migração é possível porque o `tenant_id` já é explícito em todo lugar." |
| Keycloak / provedor de identidade | descartado em 2026-09-06 | Avaliado e descartado: custódia de credencial de conector é problema de credencial de **máquina**, não de identidade de pessoa. |

Repare no padrão: quase toda linha da coluna "por quê" contém a frase "a porta continua aberta, e aqui está por quê". Adiar sem essa frase é dívida, não YAGNI.

**Onde ficam.** `.specs/project/STATE.md` §Ideias adiadas e a tabela de decisões. Uma ideia que não está lá não foi adiada — foi esquecida.

**Se violar.** Construir OAuth no M1 custaria o M1. Mas o oposto também tem custo: adiar sem registrar significa que daqui a três meses ninguém sabe se a ausência é escolha ou esquecimento.

---

## 10. Uma decisão difícil de reverter vira ADR

**ADR** (Architecture Decision Record) é o registro de uma decisão cara de desfazer, com as alternativas que foram descartadas e por quê.

**Onde aparece.** `docs/adr/001-gestao-de-segredos-de-conectores.md` é o modelo. Repare no que ele tem além da decisão:

```
  Contexto e problema        as três forças que tornam o caso especial
  Decisores da escolha       os critérios, ANTES de olhar as opções
  Opções consideradas        quatro, não uma
  Decisão                    + as três regras que a acompanham
  Consequências negativas    cinco, incluindo "é dívida consciente"
  Prós e contras por opção   inclusive das descartadas
```

A parte mais valiosa é a das consequências negativas e das opções descartadas. Quando alguém quiser trocar envelope encryption por Vault daqui a um ano, a pergunta "isso já foi considerado?" tem resposta escrita.

**A divisão de trabalho entre os três registros:**

| Registro | Guarda | Exemplo |
| --- | --- | --- |
| `docs/adr/` | decisão difícil de reverter, com alternativas | ADR-001, criptografia de segredo |
| `.specs/project/STATE.md` | as decisões numeradas (D1–D30), riscos, lições | D22, catálogo sem tabela |
| `.specs/features/<nome>/design.md` | como aquela feature vai ser construída | gate de ativação |

**Se violar.** Uma decisão registrada no `STATE.md` não muda sozinha — o `CLAUDE.md` lista "mudar uma decisão já registrada no `STATE.md`" entre as coisas que não se faz sem o Thiago. Decisão sem registro é decisão que vai ser retomada do zero, com menos informação.

---

## 11. Lição aprendida vira regra, não recado

**O princípio.** Erro que custou caro não vira comentário no commit. Vira uma linha em `.specs/project/STATE.md` §Lições e, quando é geral o bastante, uma regra em `CLAUDE.md` §Regras técnicas que já custaram caro.

**Onde aparece.** Cada uma destas nasceu de um bug real e tem a task de origem anotada:

| Lição | Origem | Virou |
| --- | --- | --- |
| NestJS + Vitest exige `@Inject(Token)` explícito (esbuild não emite `design:paramtypes`) | T11 | regra no `CLAUDE.md` + seção no `TESTING.md` |
| `current_setting(nome, true)` devolve `''` e não `NULL` em conexão reaproveitada | T5 | regra: use `nullif(...)` na policy |
| Projetos do Vitest rodam concorrentes mesmo com `fileParallelism: false` | T17 | `pnpm test` roda os três em sequência |
| `argon2.hash()` não aceita chave com valor `undefined` explícito | T14 | lição no `STATE.md` |
| Zod 4 valida UUID pela RFC de verdade; fixture `1111...` é recusado | T1 | use um v7 real como fixture |
| `import.meta` não compila sob `module: CommonJS` | T1 | teste resolve caminho de `process.cwd()` |
| `tsx` resolve `extends` do tsconfig subindo diretórios | T23 | Dockerfile copia `tsconfig.base.json` da raiz |

**Se violar.** As duas primeiras dessa tabela já se manifestaram duas vezes cada uma, por caminhos diferentes (a do `tsconfig` na T23 é a mesma causa-raiz da T11 aparecendo em outro lugar). É a evidência de que registrar funciona e de que não registrar custa o dobro.

---

## 12. Uma fonte de verdade, e nunca duplicar

**O princípio.** Cada informação mora num lugar só. Se está no `tasks.md`, não vai para a Asana. Se está no código, não vira documento.

**Onde aparece.**

| Informação | Fonte única |
| --- | --- |
| o que construir e por quê | `.specs/` |
| o que existe de fato | código + git |
| o que o Thiago acompanha | Asana |
| catálogo de agentes e conectores | `packages/catalog` — sem tabela no banco (D22) |
| identidade e sessão | tabela `sessions` no Postgres, não Redis (D18) — logout é `DELETE` |
| vocabulário de capabilities | `packages/catalog/src/capabilities.ts` |
| tradução de erro para o usuário | `apps/api/src/common/error.filter.ts` |

A D18 é o caso mais claro: sessão em Redis *e* usuário no Postgres seriam duas fontes de verdade de identidade que podem discordar. Uma só significa que "está logado?" tem uma resposta possível.

**Se violar.** Duas cópias divergem. A pergunta deixa de ser "qual é a resposta" e passa a ser "qual das duas está certa" — e não há como saber.

---

## Quando dois princípios brigam

Princípio não é lei; é peso numa balança. Quando dois puxam para lados opostos, a decisão é registrada, não improvisada.

**O caso real: D22 (catálogo no código) contra integridade referencial.**

```
  Uma fonte de verdade                       Integridade referencial do banco
  catálogo mora em packages/catalog          catálogo em tabela; FK da instância
  o código É a verdade                       o banco garante que a definição existe
        |                                          |
        +------------------ x ---------------------+
                     não dá para ter os dois
```

O que se decidiu: **venceu a fonte única**, e o custo foi pago em outro lugar. `validateCatalog` roda no boot e derruba o processo se o catálogo estiver malformado. `defineAgent` valida na chamada — "definição malformada não chega a existir como objeto" (`packages/catalog/src/define.ts`). O gate de ativação checa `AGENT_VERSION_MISSING` em runtime.

Trocou-se uma garantia do banco por três verificações da aplicação, uma delas na subida. E o risco disso ficou registrado (R6): o subconjunto de JSON Schema pode ficar apertado para um agente futuro — e a mitigação é que `validateCatalog` reprova na subida, em desenvolvimento, onde a pressão aparece cedo e barata.

**Outros conflitos e como foram resolvidos:**

| Conflito | Como foi resolvido |
| --- | --- |
| Segurança do segredo × usabilidade | Venceu segurança. O ADR-001 registra o custo: "quem esquecer uma API key precisa gerá-la de novo no fornecedor" — atrito real, aceito de olhos abertos. |
| Testes rápidos × testes reais | Divididos por camada, não por gosto. Domínio puro é `unit`; qualquer coisa que toque policy roda contra Postgres real, porque "RLS não é simulável com banco em memória". |
| Paralelismo dos testes × recurso da máquina | Venceu o recurso. `pnpm test` roda os três projetos em sequência porque rodar junto estourou a VM do Docker (T17). |
| YAGNI × porta aberta | Adiar só quando a porta continua aberta. OAuth foi para o M3, mas o **modelo de dados do M1 já o comporta** (D26). |
| Revogação segura × serviço no ar | Venceu a revogação. "Revogação de conexão nunca é bloqueada por dependência"; a instância que perde capability obrigatória cai para `paused` com motivo registrado (D27). |

**A regra do desempate.** Quando você não conseguir decidir: pergunte qual das duas escolhas é mais cara de desfazer. Escolha a outra. Se as duas forem caras, isso é um ADR, e o `CLAUDE.md` diz para parar e chamar o Thiago.

---

## Resumo em uma tela

```
  1   framework não entra em core, db, catalog     lint + teste de fronteira
  2   seis contextos, cada um dono do seu          design §4
  3   inglês no código, português na tela          D12
  4   domínio puro roda sem banco                  gate de ativação, D28
  5   erro tem código estável; traduz na borda     core/errors.ts -> error.filter.ts
  6   teste primeiro; guarda provado quebrando     TESTING.md
  7   segurança é estrutura                        RLS + ADR-001
  8   nome diz o que é; arquivo grande é sintoma   nenhum passa de ~165 linhas
  9   adiar é decisão registrada                   STATE.md §Ideias adiadas
  10  decisão irreversível vira ADR                docs/adr/
  11  lição vira regra                             CLAUDE.md §Regras que custaram caro
  12  uma fonte de verdade                         nunca duplicar
```
