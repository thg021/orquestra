import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as catalog from "../src/index";

// O tsconfig do projeto é CommonJS, então nada de import.meta. O Vitest roda da raiz
// do monorepo; o fallback cobre rodar de dentro do próprio pacote.
const FROM_ROOT = join(process.cwd(), "packages", "catalog", "src");
const SRC = existsSync(FROM_ROOT) ? FROM_ROOT : join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("fronteira do pacote", () => {
  // packages/catalog é declaração pura: precisa ser carregável pela API, pelo worker e
  // por um teste unitário sem subir nada. Depender de framework ou de persistência
  // arrastaria tudo isso junto — a mesma regra que já vale para core e db.
  it("não importa NestJS nem a camada de persistência", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file, content: readFileSync(file, "utf8") }))
      .filter(({ content }) => /from "(@nestjs\/|@orquestra\/db)/.test(content))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("superfície pública", () => {
  it("exporta o contrato de extensão e o vocabulário de capabilities", () => {
    expect(typeof catalog.defineAgent).toBe("function");
    expect(typeof catalog.defineConnector).toBe("function");
    expect(typeof catalog.secret).toBe("function");
    expect(typeof catalog.isSecret).toBe("function");
    expect(catalog.CAPABILITIES).toContain("file-storage");
    expect(catalog.InvalidDefinitionError).toBeTruthy();
  });
});
