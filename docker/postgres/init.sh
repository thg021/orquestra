#!/bin/sh
# Roda uma única vez, na primeira inicialização do volume de dados.
# POSTGRES_USER (orquestra_owner) já existe como superusuário da imagem oficial —
# aqui criamos o papel de aplicação, sem DDL e sem bypass de RLS (ADR de isolamento
# do M0 design §Papéis de banco).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orquestra_app') THEN
      CREATE ROLE orquestra_app
        LOGIN PASSWORD '${ORQUESTRA_APP_DB_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END
  \$\$;

  GRANT USAGE ON SCHEMA public TO orquestra_app;

  -- orquestra_app não recebe CREATE: toda DDL passa por orquestra_owner via migrações.
  -- Tabelas criadas depois deste bootstrap herdam DML automaticamente.
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orquestra_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO orquestra_app;

  -- citext é usado por users.email (comparação de e-mail insensível a caixa).
  CREATE EXTENSION IF NOT EXISTS citext;
EOSQL
