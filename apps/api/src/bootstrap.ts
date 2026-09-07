import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { runMigrations, type RunMigrationsOptions } from "@orquestra/db";
import { validateBuiltinCatalog, type CatalogIssue } from "@orquestra/catalog";
import { loadKeks, type KekSet } from "@orquestra/core";
import { AppModule } from "./app.module";
import { loadConfig, type AppConfig } from "./config/load-config";
import { HealthService } from "./health/health.service";
import { ErrorFilter } from "./common/error.filter";
import { InvalidCatalogError } from "./catalog/invalid-catalog.error";

export interface BootstrapOptions {
  /** Injetável em teste para simular indisponibilidade do Postgres sem um banco real. */
  runMigrationsFn?: (options: RunMigrationsOptions) => Promise<void>;
  maxMigrationRetries?: number;
  retryDelayMs?: number;
  /** Injetável em teste para simular catálogo quebrado sem editar o catálogo real. */
  validateCatalogFn?: () => readonly CatalogIssue[];
  /** Injetável em teste para simular KEK ausente/ilegível sem tocar disco. */
  loadKeksFn?: (dirPath: string) => KekSet;
}

export interface BootstrapResult {
  config: AppConfig;
  /** Ausente quando PROCESS_ROLE não é "api" — nenhuma rota HTTP é registrada. */
  app?: INestApplication;
  /** Carregada em todo papel de processo — worker e scheduler também custodiam segredo. */
  kekSet: KekSet;
}

const DEFAULT_MAX_RETRIES = 30;
const DEFAULT_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMigrationsWithRetry(
  options: RunMigrationsOptions,
  runMigrationsFn: (options: RunMigrationsOptions) => Promise<void>,
  maxRetries: number,
  retryDelayMs: number
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await runMigrationsFn(options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await sleep(retryDelayMs);
      }
    }
  }
  throw lastError;
}

/**
 * Ordem fixa: loadConfig → catálogo → migrações (com retry) → cria o app (só no papel
 * "api"). A validação do catálogo vem antes de tocar o banco de propósito — CAT-05
 * exige que a resposta do catálogo não dependa de banco, e falhar antes das migrações
 * evita reboot em loop tentando migrar um catálogo que nunca vai subir de qualquer jeito.
 * Nunca abre a porta aqui — quem faz `listen` é main.ts, para que este bootstrap
 * permaneça testável sem subir um servidor de verdade.
 */
export async function bootstrap(
  env: NodeJS.ProcessEnv,
  options: BootstrapOptions = {}
): Promise<BootstrapResult> {
  const config = loadConfig(env);

  const validateCatalogFn = options.validateCatalogFn ?? validateBuiltinCatalog;
  const catalogIssues = validateCatalogFn();
  if (catalogIssues.length > 0) {
    throw new InvalidCatalogError(catalogIssues);
  }

  // Também antes das migrações: KEK ilegível não depende de banco, e não faz sentido
  // preparar a persistência para um processo que não vai conseguir custodiar segredo.
  const loadKeksFn = options.loadKeksFn ?? loadKeks;
  const kekSet = loadKeksFn(config.KEK_DIR);

  const runMigrationsFn = options.runMigrationsFn ?? runMigrations;
  await runMigrationsWithRetry(
    { connectionString: config.DATABASE_MIGRATION_URL },
    runMigrationsFn,
    options.maxMigrationRetries ?? DEFAULT_MAX_RETRIES,
    options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  );

  if (config.PROCESS_ROLE !== "api") {
    return { config, kekSet };
  }

  const app = await NestFactory.create(AppModule.register(config, kekSet), { logger: ["error", "warn"] });
  app.use(cookieParser());
  app.useGlobalFilters(new ErrorFilter());
  app.get(HealthService).markMigrationsApplied();

  return { config, app, kekSet };
}
