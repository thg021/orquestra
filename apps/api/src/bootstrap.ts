import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { runMigrations, type RunMigrationsOptions } from "@orquestra/db";
import { AppModule } from "./app.module";
import { loadConfig, type AppConfig } from "./config/load-config";
import { HealthService } from "./health/health.service";

export interface BootstrapOptions {
  /** Injetável em teste para simular indisponibilidade do Postgres sem um banco real. */
  runMigrationsFn?: (options: RunMigrationsOptions) => Promise<void>;
  maxMigrationRetries?: number;
  retryDelayMs?: number;
}

export interface BootstrapResult {
  config: AppConfig;
  /** Ausente quando PROCESS_ROLE não é "api" — nenhuma rota HTTP é registrada. */
  app?: INestApplication;
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
 * Ordem fixa: loadConfig → migrações (com retry) → cria o app (só no papel "api").
 * Nunca abre a porta aqui — quem faz `listen` é main.ts, para que este bootstrap
 * permaneça testável sem subir um servidor de verdade.
 */
export async function bootstrap(
  env: NodeJS.ProcessEnv,
  options: BootstrapOptions = {}
): Promise<BootstrapResult> {
  const config = loadConfig(env);

  const runMigrationsFn = options.runMigrationsFn ?? runMigrations;
  await runMigrationsWithRetry(
    { connectionString: config.DATABASE_MIGRATION_URL },
    runMigrationsFn,
    options.maxMigrationRetries ?? DEFAULT_MAX_RETRIES,
    options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  );

  if (config.PROCESS_ROLE !== "api") {
    return { config };
  }

  const app = await NestFactory.create(AppModule.register(config), { logger: ["error", "warn"] });
  app.use(cookieParser());
  app.get(HealthService).markMigrationsApplied();

  return { config, app };
}
