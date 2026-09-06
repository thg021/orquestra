# M0 mira o ambiente de desenvolvimento (produção fica para quando houver o que
# publicar). Roda via tsx em vez do dist compilado: os pacotes do workspace
# (@orquestra/db, @orquestra/core, @orquestra/contracts) apontam "main" para
# ./src/index.ts, então um `node dist/main.js` puro quebraria ao tentar importar
# TypeScript sem um runtime que o entenda. tsx resolve isso igual em dev e aqui.
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

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 3000
CMD ["pnpm", "run", "start:dev"]
