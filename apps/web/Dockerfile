# M0 mira o ambiente de desenvolvimento: serve o dev server do Vite, não um build
# estático servido por nginx — build de produção do painel fica para quando M0 sair
# de escopo de "ambiente de desenvolvimento".
FROM node:20-alpine
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web

WORKDIR /app/apps/web
EXPOSE 5173
CMD ["pnpm", "run", "dev"]
