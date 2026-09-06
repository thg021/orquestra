import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadKeks, InvalidKekError } from "../../src/vault/kek";

let dir: string | undefined;

function makeDir(): string {
  dir = mkdtempSync(join(tmpdir(), "orquestra-kek-"));
  return dir;
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("loadKeks", () => {
  it("carrega uma única versão e a expõe como versão corrente", () => {
    const path = makeDir();
    const key = randomBytes(32);
    writeFileSync(join(path, "1"), key);

    const keks = loadKeks(path);

    expect(keks.currentVersion).toBe(1);
    expect(keks.get(1)).toEqual(key);
  });

  it("carrega mais de uma versão; a corrente é a de maior número", () => {
    const path = makeDir();
    const v1 = randomBytes(32);
    const v2 = randomBytes(32);
    writeFileSync(join(path, "1"), v1);
    writeFileSync(join(path, "2"), v2);

    const keks = loadKeks(path);

    expect(keks.currentVersion).toBe(2);
    expect(keks.get(1)).toEqual(v1);
    expect(keks.get(2)).toEqual(v2);
  });

  it("aceita conteúdo hexadecimal de 64 caracteres, além do binário cru", () => {
    const path = makeDir();
    const key = randomBytes(32);
    writeFileSync(join(path, "1"), key.toString("hex"));

    const keks = loadKeks(path);

    expect(keks.get(1)).toEqual(key);
  });

  it("ignora arquivo cujo nome não é um número de versão", () => {
    const path = makeDir();
    writeFileSync(join(path, "1"), randomBytes(32));
    writeFileSync(join(path, ".gitkeep"), "");

    const keks = loadKeks(path);

    expect(keks.currentVersion).toBe(1);
  });

  it("recusa diretório inexistente, nomeando o caminho", () => {
    expect(() => loadKeks("/caminho/que/nao/existe/kek")).toThrowError(InvalidKekError);
    expect(() => loadKeks("/caminho/que/nao/existe/kek")).toThrowError(/caminho\/que\/nao\/existe\/kek/);
  });

  it("recusa diretório sem nenhuma versão válida", () => {
    const path = makeDir();
    writeFileSync(join(path, ".gitkeep"), "");

    expect(() => loadKeks(path)).toThrowError(InvalidKekError);
  });

  it("recusa arquivo de KEK com tamanho errado, nomeando a versão e nunca o conteúdo", () => {
    const path = makeDir();
    writeFileSync(join(path, "1"), "chave-curta-demais");

    try {
      loadKeks(path);
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidKekError);
      expect((error as Error).message).toContain("1");
      expect((error as Error).message).not.toContain("chave-curta-demais");
    }
  });

  it("get() de versão não carregada lança, sem derrubar as demais", () => {
    const path = makeDir();
    writeFileSync(join(path, "1"), randomBytes(32));
    const keks = loadKeks(path);

    expect(() => keks.get(99)).toThrowError(InvalidKekError);
  });

  it("recusa um caminho que é arquivo, não diretório", () => {
    const path = makeDir();
    const filePath = join(path, "nao-e-diretorio");
    writeFileSync(filePath, "x");

    expect(() => loadKeks(filePath)).toThrowError(InvalidKekError);
  });
});
