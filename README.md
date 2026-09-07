# Orquestra

Plataforma multitenant de automação com agentes. Este repositório está no **M1 — Núcleo plugável**: além da fundação do M0 (ambiente reprodutível, isolamento de tenant via Row-Level Security, autenticação com sessão em cookie), um tenant já consegue instalar um agente do catálogo, configurá-lo, conectar as credenciais que ele precisa e ativá-lo — tudo pelo painel.

Design completo em [`docs/specs/2026-09-05-orquestra-design.md`](docs/specs/2026-09-05-orquestra-design.md). Especificação e decisões do M0 em [`.specs/features/foundation/`](.specs/features/foundation/); do M1 em [`.specs/features/pluggable-core/`](.specs/features/pluggable-core/).

## Subir o ambiente

Requisitos: [Docker Desktop](https://www.docker.com/products/docker-desktop/) e [pnpm](https://pnpm.io/) (via `corepack enable`, já vem com o Node ≥ 16.9).

```bash
git clone <url-do-repositorio>
cd orquestra
cp .env.example .env
# edite .env: preencha POSTGRES_PASSWORD, ORQUESTRA_APP_DB_PASSWORD e SESSION_SECRET
# (openssl rand -hex 32 gera um valor razoável para cada um)

pnpm dev
```

`pnpm dev` sobe `postgres`, `redis`, `api` e `web` via Docker Compose, aplicando as migrações automaticamente antes da API aceitar requisições.

- Painel: http://localhost:5173
- API: http://localhost:3000 — `GET /health/live` (processo de pé) e `GET /health/ready` (migrações aplicadas + Postgres respondendo)

O compose lê variáveis de `docker/.env` (não versionado). Se você preencheu apenas o `.env` da raiz, copie os mesmos valores para `docker/.env` — são arquivos distintos porque o Compose resolve variáveis relativas ao diretório do arquivo `compose.yml`.

## Criar o primeiro tenant

Não há cadastro pelo painel no M0 (fora de escopo — ver spec). Um operador provisiona pelo CLI, dentro do container `api`:

```bash
docker compose -f docker/compose.yml run --rm api pnpm cli tenant:create \
  --name "Nome do Escritório" \
  --email "dono@escritorio.com" \
  --password "uma-senha-com-doze-caracteres-ou-mais"
```

A senha também pode vir por stdin, para não ficar no histórico do shell:

```bash
echo "uma-senha-com-doze-caracteres-ou-mais" | docker compose -f docker/compose.yml run --rm api pnpm cli tenant:create \
  --name "Nome do Escritório" --email "dono@escritorio.com"
```

Redefinir senha de um usuário existente:

```bash
docker compose -f docker/compose.yml run --rm api pnpm cli user:reset-password --email "dono@escritorio.com" --password "senha-nova"
```

Depois, entre em http://localhost:5173/login com o e-mail e a senha informados.

## Custódia e rotação da KEK (M1)

Toda credencial de conector que o tenant cadastra (API key, refresh token) é cifrada antes de chegar ao banco — nunca em texto claro. O segredo em si (`secret_envelope`) é cifrado por uma chave gerada na hora (a DEK), e a DEK é cifrada pela KEK do escritório antes de ser guardada. É essa KEK, e só ela, que o operador precisa custodiar.

**A KEK nunca é variável de ambiente** — vaza fácil demais (`docker inspect`, dump de processo, log acidental). Ela é um arquivo, montado como Docker secret, um arquivo por versão, nome do arquivo = número da versão. `KEK_DIR` aponta para o diretório onde esses arquivos ficam montados dentro do container.

### Gerar a primeira KEK (v1)

Antes do primeiro `pnpm dev`:

```bash
openssl rand -out docker/secrets/kek/1 32
```

`docker/secrets/kek/` não é versionado (está no `.gitignore`) — é segredo local ou de produção, nunca commit. Guarde uma cópia do arquivo `1` em um cofre de senhas ou gerenciador de secrets da equipe: **se esse arquivo se perder, toda credencial de conector cadastrada por todos os tenants fica ilegível para sempre.** Não há recuperação — é matemática, não suporte técnico.

### Rotacionar a KEK

Rotação não decifra nenhum segredo do escritório — ela troca só a camada que protege a DEK de cada conexão (design ADR-001, decisão D34). O `secret_envelope` do escritório nunca é tocado.

1. Gere a nova versão **no mesmo diretório**, sem apagar a anterior:
   ```bash
   openssl rand -out docker/secrets/kek/2 32
   ```
2. Monte a v2 também como secret do Compose (edite `docker/compose.yml`: adicione `kek_v2` em `secrets:` e no `secrets:` do serviço `api`, seguindo o padrão de `kek_v1`) e suba o container de novo — as duas versões precisam conviver montadas enquanto a rotação roda.
3. Rode o comando de rotação dentro do container `api`:
   ```bash
   docker compose -f docker/compose.yml run --rm api pnpm cli kek:rotate --to-version 2
   ```
   O comando é seguro para interromper e rodar de novo: ele varre toda conexão com `key_version < 2` e recifra a DEK, uma conexão por transação — o que já foi migrado não é refeito.
4. Confirme que `connectionsRewrapped` bateu com o esperado, então remova a v1 do Compose (mantenha o arquivo `docker/secrets/kek/1` arquivado no cofre da equipe por um tempo, caso precise abrir um backup antigo do banco).

**Nunca remova um arquivo de versão de KEK enquanto houver conexão com aquele `key_version` no banco** — isso torna aquela conexão irrecuperável.

## Verificação

```bash
pnpm check     # lint + typecheck + testes (unit → integration → e2e, nessa ordem)
pnpm build     # compila os pacotes TypeScript
```

Testes de integração e e2e sobem Postgres efêmero via [Testcontainers](https://testcontainers.com/) — exigem Docker rodando. `pnpm test` roda os três projetos do Vitest **em sequência** (nunca `vitest run` direto): `integration` e `e2e` são projetos distintos que o Vitest paralelizaria por padrão, e cada suíte sobe seu próprio Postgres — rodar os dois ao mesmo tempo pode saturar a memória do Docker Desktop em máquinas com pouco recurso alocado à VM.

Detalhes de cobertura de teste, gates e convenções: [`.specs/codebase/TESTING.md`](.specs/codebase/TESTING.md).

## Estrutura

```
apps/
  api/      NestJS — HTTP, CLI do operador, worker/scheduler (papéis futuros)
  web/      React + Vite — painel
packages/
  db/       schema Drizzle, migrações, contexto de tenant (withTenant/withoutTenant)
  core/     domínio puro: identificadores, papéis, erros, hash de senha, cofre de segredos (envelope encryption)
  catalog/  catálogo de agentes e conectores — código, sem tabela no banco
  contracts/ schemas Zod compartilhados entre api e web
docker/
  compose.yml
```

Regra de dependência: `web → contracts`; `api → contracts, core, db, catalog`; `catalog → core`; `db → core`; `core` não depende de nada do monorepo.

## Escopo do M0

Dentro: ambiente reprodutível, RLS testada, provisionamento por CLI, autenticação por e-mail/senha, shell autenticado.

Fora (propositalmente — ver [spec](.specs/features/foundation/spec.md#out-of-scope)): cadastro self-service, convite de usuários pelo painel, seletor de tenant, recuperação de senha por e-mail, catálogo/conectores/execução (M1+), deploy em produção e HTTPS.

## Escopo do M1

Dentro: catálogo de agentes/conectores (código, sem tabela); instalar/configurar/remover instância de serviço; cofre de segredos com envelope encryption e rotação de KEK; conectar credencial e vincular capability; ativar/pausar com gate de validação; painel completo (catálogo, tela da instância, tela de conexões).

Fora (propositalmente — ver [spec](.specs/features/pluggable-core/spec.md)): execução de verdade do agente (M2), fluxo OAuth completo (credencial é colada à mão até o M3), verificação real de conexão contra o fornecedor (M1 sempre grava `unverified`, atrás da mesma interface que o M3 vai preencher).
