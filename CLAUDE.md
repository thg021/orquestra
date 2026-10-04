# Orquestra — como trabalhamos aqui

Este arquivo é lido no começo de toda sessão. Ele diz o combinado entre o Thiago e o Claude para desenvolver a Orquestra.

---

## O que é a Orquestra

Uma plataforma onde um escritório contábil instala um serviço pronto, conecta as contas que ele usa (e-mail, drive, etc) e deixa rodando. A rotina que hoje é feita à mão passa a rodar sozinha, com uma parada para aprovação humana antes de qualquer envio.

Vários escritórios usam o mesmo banco de dados. É o Postgres que impede um enxergar o outro — não a disciplina de quem escreve query.

**Onde estamos:**

```
  M0  Fundação . . . . . . . . concluído em 06/09/2026
  M1  Núcleo plugável . . . .  concluído em 06/09/2026
  M2  Runtime de execução . .  em andamento
  M3  Carteira e automação
  M4  Conectores reais
  M5  Operações
  M6  Acesso e equipe
  M7  UC-001 no piloto (agente contábil)
```

---

## Tom de escrita

Documento nesse projeto é escrito em **linguagem simples**. Frases curtas, voz ativa, sem prosa densa.

Quando um diagrama ASCII explicar melhor que um parágrafo, use o diagrama. O Thiago vai reler esses documentos semanas depois, sem o contexto da conversa — documento que exige esforço para decifrar não cumpre a função.

Isso vale para `.specs/`, `docs/`, cards da Asana e para o que aparece no terminal.

---

## Onde mora cada coisa

```
  .specs/       o que construir e por quê       Claude lê e escreve
  código + git  o que existe de fato            Claude escreve
  Asana         o que o Thiago acompanha        Claude move o card,
                e decide                        o Thiago decide
```

**Nunca duplicar.** Se a informação está no `tasks.md`, ela não vai para a Asana. Se está no código, não vira documento.

Arquivos que mandam:

| Arquivo | O que tem dentro |
| --- | --- |
| `.specs/project/ROADMAP.md` | os milestones e o estado de cada um |
| `docs/prd/PRD-Orquestra-MVP-v1.0.md` | o produto do MVP: o que e por quê, sem tecnologia |
| `.specs/project/PRD-MVP-GAP.md` | requisito por requisito do PRD: o que existe e o que falta |
| `.specs/project/STATE.md` | decisões tomadas, riscos, lições aprendidas |
| `.specs/features/<nome>/spec.md` | o que precisa existir e por quê |
| `.specs/features/<nome>/design.md` | como vai ser construído |
| `.specs/features/<nome>/tasks.md` | as tarefas, uma entrega cada, com dependências |
| `.specs/codebase/TESTING.md` | como os testes rodam |
| `.specs/codebase/PRINCIPLES.md` | princípios de código: fronteiras, domínio, TDD, segurança |
| `.specs/codebase/stacks/` | padrões por stack — leia o da stack que você vai tocar |
| `docs/adr/` | decisões difíceis de reverter, com as alternativas descartadas |

Antes de escrever código, leia o documento da stack que vai tocar:

```
  backend, API, NestJS . . . . .  .specs/codebase/stacks/backend-nestjs.md
  painel, React, Vite  . . . . .  .specs/codebase/stacks/frontend-react.md
  banco, migração, RLS . . . . .  .specs/codebase/stacks/data-drizzle-postgres.md
  teste . . . . . . . . . . . .   .specs/codebase/stacks/testing-vitest.md
  qualquer um deles  . . . . . .  .specs/codebase/PRINCIPLES.md
```

Board da Asana: projeto **Orquestra**, workspace My Company.

---

## O ciclo de uma task

```
  leio a task  ->  escrevo o teste  ->  faço passar  ->  pnpm check  ->  commit
```

- **Uma task por vez.** Terminar antes de começar a próxima.
- **Teste antes do código.** Se a task não diz como testar, pergunto antes de escrever.
- **Um commit por task**, citando o número: `feat(catalog): registry de definições (T1)`
- **Branch por user story:** `m1/us1-catalogo`

---

## Começo e fim de sessão

**No começo:** leio o `STATE.md` e o `tasks.md` do milestone atual, e digo em uma linha o que vou fazer.

**No fim:**
1. marco no `tasks.md` o que ficou pronto
2. registro no `STATE.md` decisão nova ou lição aprendida
3. movo o card na Asana
4. resumo em três linhas o que andou

---

## Quando eu paro e chamo o Thiago

```
  antes de começar uma US nova       confirmo o escopo
  decisão que muda o design          registro no STATE só com o ok dele
  qualquer coisa que toque segredo   ele revisa antes do commit
  US terminada                       ele valida no navegador
  dependência nova no projeto        aviso e explico por quê
```

---

## O que eu nunca faço sozinho

- `git push`, abrir PR, fazer merge
- mexer em `.env` real ou em qualquer credencial de verdade
- gerar ou manusear a chave mestra (KEK) real — isso é do Thiago, e ela nunca passa por uma conversa comigo
- mudar uma decisão já registrada no `STATE.md`
- sair do escopo da task que estou fazendo

---

## Pronto de verdade

Uma user story só está pronta quando:

```
  [ ] testes verdes
  [ ] pnpm check limpo
  [ ] tasks.md marcado
  [ ] STATE.md atualizado
  [ ] card na coluna Revisão, esperando o Thiago
```

---

## Regras técnicas que já custaram caro

Estas nasceram de erro real. Estão aqui para não acontecer de novo.

**Injeção de dependência no NestJS precisa ser explícita.** Todo construtor de controller ou provider usa `@Inject(Token)`, nunca só o tipo do parâmetro. O Vitest transpila com esbuild, que não emite os metadados que o NestJS usaria para adivinhar. (Descoberto na T11 do M0.)

**Toda tabela com dado de escritório tem `tenant_id` e proteção de isolamento ligada.** Existe um teste que varre o banco e quebra o build se alguma nascer sem. Não desligue esse teste — conserte a tabela.

**Acesso a banco só passa por `withTenant` ou `withoutTenant`.** Não existe caminho alternativo para o pool, e uma regra de lint garante isso.

**Na policy de isolamento, use `nullif(current_setting('app.tenant_id', true), '')::uuid`.** Sem o `nullif`, a policy quebra quando o pool reaproveita conexão. (Descoberto na T5 do M0.)

**Nenhuma mensagem de erro ou log carrega senha, token, chave ou string de conexão.** Erro de driver é limpo antes de virar log.

**Os três projetos de teste rodam em sequência, não em paralelo.** Cada um sobe um Postgres próprio via Testcontainers, e rodar junto satura a memória do Docker. É por isso que `pnpm test` é sequencial. (Descoberto na T17 do M0.)

**`drizzle-kit` 0.28 não gera `FORCE ROW LEVEL SECURITY` — só `ENABLE`.** Toda tabela nova sob RLS precisa da linha `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` acrescentada à mão na migração gerada. Sem isso, o teste de introspecção de RLS reprova nomeando a tabela. (Redescoberto na T9 do M1 — já valia desde o M0.)

**`pnpm run test:int` completo pode falhar por falta de recurso no Docker, não por regressão.** Se vários arquivos falharem juntos sem relação óbvia entre si, rode os arquivos afetados em lotes pequenos antes de assumir que quebrou algo — nenhum container órfão sobra depois, é só contenção de memória/CPU. (Descoberto na T11 do M1.)

**Docker Compose cacheia o objeto de secret no daemon quando usa driver `file:`.** Trocar o conteúdo do arquivo no host depois que o container já foi criado não atualiza o secret montado — nem `up -d` nem `--force-recreate` bastam. É preciso `docker compose down` (que remove os secrets) antes de subir de novo. (Descoberto na T5 do M1, testando a KEK ao vivo.)

---

## Convenções

- Identificadores, tabelas e nomes de coleção em **inglês**. Texto que o usuário lê, em **português**.
- Identificadores são UUID v7 gerados na aplicação.
- Regra de dependência entre pacotes: `web → contracts`, `api → contracts, core, db`, `db → core`, `core → nada`. `core` e `db` não conhecem NestJS.
- Comandos: `pnpm dev` sobe tudo · `pnpm check` roda lint, tipos e testes · `pnpm cli` são os comandos de operador.
