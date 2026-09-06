import { describe, it, expect } from "vitest";
import { loadConfig, InvalidConfigError } from "../../src/config/load-config";

const validEnv = {
  DATABASE_URL: "postgres://orquestra_app:secret@localhost:5432/orquestra",
  DATABASE_MIGRATION_URL: "postgres://orquestra_owner:secret@localhost:5432/orquestra",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "a".repeat(32),
  API_PORT: "3000",
  PROCESS_ROLE: "api"
};

describe("loadConfig", () => {
  it("ambiente completo produz config tipada", () => {
    const config = loadConfig(validEnv);
    expect(config.API_PORT).toBe(3000);
    expect(config.PROCESS_ROLE).toBe("api");
  });

  it("três variáveis ausentes geram um erro que nomeia as três", () => {
    const rest = { ...validEnv };
    delete (rest as Partial<typeof validEnv>).DATABASE_URL;
    delete (rest as Partial<typeof validEnv>).REDIS_URL;
    delete (rest as Partial<typeof validEnv>).SESSION_SECRET;

    let caught: unknown;
    try {
      loadConfig(rest);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidConfigError);
    const error = caught as InvalidConfigError;
    expect(error.variables).toEqual(
      expect.arrayContaining(["DATABASE_URL", "REDIS_URL", "SESSION_SECRET"])
    );
    expect(error.variables).toHaveLength(3);
  });

  it("porta não numérica é recusada", () => {
    expect(() => loadConfig({ ...validEnv, API_PORT: "não-é-porta" })).toThrow(InvalidConfigError);
  });

  it("URL malformada é recusada", () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: "isto-nao-e-uma-url" })).toThrow(
      InvalidConfigError
    );
  });

  it("a mensagem de erro não ecoa o valor da variável, só o nome", () => {
    const secretValue = "valor-secreto-que-nao-pode-vazar-no-log";
    let caught: unknown;
    try {
      loadConfig({ ...validEnv, DATABASE_URL: secretValue });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidConfigError);
    expect((caught as Error).message).not.toContain(secretValue);
    expect((caught as Error).message).toContain("DATABASE_URL");
  });
});
