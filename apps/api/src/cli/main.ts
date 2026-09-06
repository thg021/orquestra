import readline from "node:readline";
import { closeDefaultPool } from "@orquestra/db";
import { loadConfig } from "../config/load-config";
import { runTenantCreate } from "./commands/tenant-create";
import { runUserResetPassword } from "./commands/user-reset-password";
import { runKekRotate } from "./commands/kek-rotate";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token?.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = "";
      }
    }
  }
  return flags;
}

/** Lê uma linha de stdin — a senha não passa pelo argv, então não fica no histórico do shell. */
function readPasswordFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    rl.on("error", reject);
  });
}

async function resolvePassword(flags: Record<string, string>): Promise<string> {
  if (flags.password) {
    return flags.password;
  }
  return readPasswordFromStdin();
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case "kek:rotate": {
      if (!flags["to-version"]) {
        throw new Error("Uso: kek:rotate --to-version <número>");
      }
      const toVersion = Number(flags["to-version"]);
      if (!Number.isInteger(toVersion) || toVersion <= 0) {
        throw new Error(`--to-version precisa ser um inteiro positivo, recebido: "${flags["to-version"]}"`);
      }
      const result = await runKekRotate({ toVersion, kekDir: config.KEK_DIR });
      console.log(
        `Rotação para a versão ${toVersion} concluída: ${result.connectionsRewrapped} conexão(ões) recifrada(s) em ${result.tenantsScanned} tenant(s).`
      );
      return;
    }
    case "tenant:create": {
      if (!flags.name || !flags.email) {
        throw new Error("Uso: tenant:create --name <nome> --email <email> [--password <senha>]");
      }
      const password = await resolvePassword(flags);
      const result = await runTenantCreate({ name: flags.name, email: flags.email, password });
      console.log(`Tenant criado: ${result.tenantId} (usuário ${result.userId})`);
      return;
    }
    case "user:reset-password": {
      if (!flags.email) {
        throw new Error("Uso: user:reset-password --email <email> [--password <nova-senha>]");
      }
      const password = await resolvePassword(flags);
      await runUserResetPassword({ email: flags.email, password });
      console.log(`Senha redefinida para ${flags.email}`);
      return;
    }
    default:
      throw new Error(
        `Comando desconhecido: "${command ?? ""}". Use tenant:create, user:reset-password ou kek:rotate.`
      );
  }
}

main()
  .then(async () => {
    await closeDefaultPool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    await closeDefaultPool().catch(() => {});
    process.exit(1);
  });
