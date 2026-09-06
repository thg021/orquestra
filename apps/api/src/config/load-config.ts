import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL precisa ser uma URL válida"),
  DATABASE_MIGRATION_URL: z.string().url("DATABASE_MIGRATION_URL precisa ser uma URL válida"),
  REDIS_URL: z.string().url("REDIS_URL precisa ser uma URL válida"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa ter ao menos 32 caracteres"),
  API_PORT: z.coerce.number({ invalid_type_error: "API_PORT precisa ser numérica" }).int().positive(),
  PROCESS_ROLE: z.enum(["api", "worker", "scheduler"])
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Nomeia TODAS as variáveis com problema, nunca só a primeira — e nunca ecoa o valor
 * fornecido, só o nome da variável e uma descrição do que se esperava.
 */
export class InvalidConfigError extends Error {
  public readonly variables: string[];

  constructor(variables: string[]) {
    super(`Configuração de ambiente inválida: ${variables.join(", ")}`);
    this.name = "InvalidConfigError";
    this.variables = variables;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const variables = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new InvalidConfigError(variables);
  }
  return result.data;
}
