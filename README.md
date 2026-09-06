# Orquestra

Plataforma multitenant de automação com agentes. Este repositório está no **M0 — Fundação**: ambiente reprodutível, isolamento de tenant garantido pelo Postgres via Row-Level Security, e autenticação com sessão em cookie.

Design completo em [`docs/specs/2026-09-05-orquestra-design.md`](docs/specs/2026-09-05-orquestra-design.md). Especificação e decisões do M0 em [`.specs/features/foundation/`](.specs/features/foundation/).

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
  core/     domínio puro: identificadores, papéis, erros, hash de senha
  contracts/ schemas Zod compartilhados entre api e web
docker/
  compose.yml
```

Regra de dependência: `web → contracts`; `api → contracts, core, db`; `db → core`; `core` não depende de nada do monorepo.

## Escopo do M0

Dentro: ambiente reprodutível, RLS testada, provisionamento por CLI, autenticação por e-mail/senha, shell autenticado.

Fora (propositalmente — ver [spec](.specs/features/foundation/spec.md#out-of-scope)): cadastro self-service, convite de usuários pelo painel, seletor de tenant, recuperação de senha por e-mail, catálogo/conectores/execução (M1+), deploy em produção e HTTPS.
