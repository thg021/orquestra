# State

**Última atualização:** 2026-09-06
**Fase atual:** M1 — Núcleo plugável em execução; 5/25 tasks (T1 a T5 concluídas em 2026-09-06) — US1 fechada

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
| D16 | 2026-09-05 | Drizzle ORM + drizzle-kit como camada de dados e migrações — SQL-first mantém RLS e `SET LOCAL` no caminho feliz da ferramenta | M0 design §Decisões técnicas |
| D17 | 2026-09-05 | React + Vite (SPA) no painel; preserva a fronteira api/web e é o caminho para um app Tauri no Windows depois | M0 design §Decisões técnicas |
| D18 | 2026-09-05 | Sessão com estado em tabela `sessions` no Postgres, não em Redis — logout é DELETE e há uma só fonte de verdade de identidade | M0 design §Decisões técnicas |
| D19 | 2026-09-05 | Dois papéis de banco: `orquestra_owner` (DDL, migrações) e `orquestra_app` (DML, `NOBYPASSRLS`), com `FORCE ROW LEVEL SECURITY` nas tabelas de tenant | M0 design §Modelo de dados |
| D20 | 2026-09-05 | Monorepo em `apps/{api,web}` + `packages/{db,core,contracts}`, com regra de dependência que impede `core`/`db` conhecerem NestJS | M0 design §Estrutura do monorepo |
| D21 | 2026-09-05 | Vitest como runner único do monorepo e Testcontainers para o Postgres dos testes de RLS; testes `e2e` não rodam em paralelo | `.specs/codebase/TESTING.md` |
| D22 | 2026-09-06 | Catálogo servido do código (`packages/catalog`), sem tabela no banco — uma fonte de verdade só; a validação de boot substitui a integridade referencial | M1 design §Componentes |
| D23 | 2026-09-06 | `config_schema` e `auth_schema` escritos em Zod, com JSON Schema derivado para gerar o formulário do painel | M1 design §Decisões técnicas |
| D30 | 2026-09-06 | Monorepo migrado do Zod 3 para o Zod 4.5.4. `z.toJSONSchema()` é nativo (dispensa `zod-to-json-schema`) e `.meta()` carrega metadado custom até o JSON Schema — é o mecanismo do marcador `secret()`, no lugar do `.describe()` estruturado que o design previa. Revisa a D23. | T1 |
| D31 | 2026-09-06 | Conectores OAuth do M1 (`onedrive`, `google-drive`, `gmail`) pedem um `refreshToken` colado à mão no `auth_schema` — ponte até o fluxo real do M3, sem mudar o formato salvo no cofre | T3 |
| D32 | 2026-09-06 | Canal de contato de `customers` reaproveita o vocabulário de capability de saída (`email`/`messaging`/`document-delivery`) em vez de um enum próprio | T3 |
| D33 | 2026-09-06 | KEK montada como diretório de Docker secrets (um arquivo por versão, nome = número da versão) em vez de uma variável só — é o que sustenta múltiplas versões coexistindo (ROT-04/D24) | T5 |
| D24 | 2026-09-06 | DEK aleatória por conexão, guardada cifrada sob chave de tenant derivada por HKDF da KEK — rotação de KEK recifra só as DEKs, nunca os segredos | M1 design §Cofre |
| D25 | 2026-09-06 | Envelope binário único (`versão‖IV‖tag‖ciphertext`) em `bytea`, com AAD `tenant ‖ conexão ‖ versão` — mover linha cifrada entre tenants não decifra | M1 design §Cofre |
| D26 | 2026-09-06 | Fluxo OAuth adiado para o M3, junto do primeiro adapter que consome o token; o M1 entrega credencial por formulário e o modelo já preparado | M1 spec §Out of Scope |
| D27 | 2026-09-06 | Revogação de conexão nunca é bloqueada por dependência; instâncias que perdem capability obrigatória caem para `paused` com motivo registrado | M1 design §Fluxos |
| D28 | 2026-09-06 | Gate de ativação como função pura sobre catálogo, instância e bindings — testável sem banco e reutilizável pelo worker do M2 | M1 design §Componentes |
| D29 | 2026-09-06 | Renderizador de formulário próprio sobre subconjunto documentado de JSON Schema, validado no boot, em vez de biblioteca de formulário-por-esquema | M1 design §Decisões técnicas |

## Bloqueios e riscos abertos

| # | Risco | Quando resolver |
|---|---|---|
| ~~R1~~ | ~~Graph API com conta Microsoft pessoal pode não funcionar.~~ **Fechado em 2026-09-05** — mitigado por desenho: `file-storage` tem três adapters (`onedrive`, `google-drive`, `platform-upload`). Provar a Graph API no M3 continua valendo, mas não é bloqueante. | — |
| ~~R2~~ | ~~Cobertura da API do Fortes Conecta.~~ **Fechado em 2026-09-05** — não é risco: há três vias de entrega escolhidas por destinatário; lacuna no Fortes afeta só os clientes daquele canal. | — |
| R3 | NestJS e BullMQ são escolhas de conveniência ainda não validadas na prática. | Revisáveis na Fase 0 sem impacto no resto do design. |
| R4 | Reescrever regras hoje implícitas no prompt da skill pode perder comportamento. | Cada regra migrada vira teste antes de virar código (M4). |
| R5 | Perder a KEK torna todo segredo de conector irrecuperável. | Custódia e rotação viram procedimento escrito no M1 (T25), e `kek:rotate` é provado em teste antes de existir credencial real. |
| R6 | O subconjunto de JSON Schema do formulário pode ficar apertado para um agente futuro. | `validateCatalog` reprova na subida, em desenvolvimento — a pressão aparece cedo e barata (M1 T2). |

## Lições

- **NestJS + Vitest: injeção de dependência implícita por tipo não funciona.** O Vitest transpila via esbuild, que não emite `design:paramtypes` (só o `tsc` real emite, via `emitDecoratorMetadata`). Todo construtor de controller/provider precisa de `@Inject(Token)` explícito — nunca só o tipo do parâmetro. Descoberto em T11, virou convenção documentada em `TESTING.md`.
- **`current_setting(nome, true)` pode devolver `''` em vez de `NULL`** numa conexão que já teve o GUC customizado tocado antes na mesma sessão (mesmo depois do fim da transação que o setou com `is_local`). Como o pool reaproveita conexões, uma policy de RLS que compara direto com `::uuid` pode quebrar em vez de simplesmente filtrar. Corrigido envolvendo em `nullif(current_setting(...), '')::uuid`. Descoberto em T5.
- **`argon2.hash()` não trata chave com valor `undefined` explícito como "use o default".** Passar `{ memoryCost: options.memoryCost }` quando `options.memoryCost` é `undefined` quebra a validação interna da lib. É preciso omitir a chave inteira, não só deixar o valor `undefined`. Descoberto em T14.
- **Projetos distintos do Vitest rodam concorrentes por padrão**, mesmo com `fileParallelism: false` (que só serializa arquivos *dentro* de um projeto). Como `integration` e `e2e` sobem Postgres via Testcontainers cada um, isso pode saturar a memória do Docker Desktop. `pnpm test` roda os três projetos em sequência por isso. Descoberto em T17.
- **Docker Compose cacheia o objeto de secret no daemon quando usa driver `file:`.** Trocar o conteúdo do arquivo host depois que o container já foi criado não atualiza o secret montado — nem `up -d` nem `--force-recreate` bastam. É preciso `docker compose down` (remove os secrets) antes de subir de novo. Descoberto testando a T5 ao vivo.
- **Zod 4 valida UUID pela RFC de verdade.** O fixture `11111111-1111-1111-1111-111111111111` passava no Zod 3 e é recusado no Zod 4: o nibble de versão e o de variante não batem com a RFC 9562. IDs reais (v7, do `newId`) passam normalmente — o teste é que estava frouxo. Ao escrever fixture de UUID, use um v7 de verdade. Descoberto na migração da T1.
- **`import.meta` não compila sob o `module: CommonJS` do projeto.** Teste que precisa do próprio caminho resolve a partir de `process.cwd()` (o Vitest roda da raiz do monorepo). Descoberto na T1.
- **`tsx` (esbuild) resolve `tsconfig.json` com `extends` relativo subindo diretórios** — então o Dockerfile precisa copiar `tsconfig.base.json` da raiz, não só o pacote sendo buildado, senão decorators quebram silenciosamente (mesma causa-raiz do primeiro item, manifestada de outro jeito). Descoberto em T23.
- **Pacotes do workspace com `main` apontando para `./src/index.ts`** (sem build) funcionam bem sob bundler (Vite) e sob runtime com transpilação on-the-fly (tsx), mas quebram sob `node` puro contra `dist/`. A API roda em produção via `tsx` no M0 (ambiente de desenvolvimento é o alvo declarado do milestone); virar isso num build real de produção fica para quando M0 sair de escopo dev.

## Todos

- [x] Definir a estrutura do monorepo (pacotes e fronteiras) na Fase 0 — fechado em 2026-09-05 (D20)
- [ ] Provar a Graph API com a conta pessoal no M3 (não bloqueante — define só qual adapter de `file-storage` o tenant piloto usa)
- [ ] Levantar a documentação da API do Fortes Conecta ao iniciar o adapter
- [ ] Extrair as regras de negócio da skill `rotina-contabil` para uma lista de casos de teste antes do M4

## Ideias adiadas

- Catálogo de conectores MCP dirigido por manifesto, sem deploy
- Banco dedicado por tenant para planos com exigência de isolamento físico
- Limites de gasto por tenant sobre a contabilidade de custo já coletada
- Onboarding self-service para novos tenants
- Keycloak (ou outro provedor de identidade) para login de usuário no painel, se um tenant quiser entrar com a conta corporativa — avaliado em 2026-09-06 e descartado para custódia de credencial de conector, que é problema de credencial de máquina, não de identidade de pessoa

## Preferências

_(vazio)_

## Fontes de verdade

- Design arquitetural: `docs/specs/2026-09-05-orquestra-design.md`
- Decisões: `docs/adr/`
- Especificação de origem do agente contábil: skill `rotina-contabil` em `C:/Users/thiago.silva/projects/escritorio/.claude/skills/rotina-contabil/` (incluindo `references/` e `clientes.yaml`)
