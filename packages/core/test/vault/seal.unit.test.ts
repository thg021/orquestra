import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadKeks } from "../../src/vault/kek";
import { createVault, OpenError } from "../../src/vault/seal";

let dir: string | undefined;

function kekSetWith(...versions: number[]) {
  dir = mkdtempSync(join(tmpdir(), "orquestra-vault-"));
  for (const version of versions) {
    writeFileSync(join(dir, String(version)), randomBytes(32));
  }
  return loadKeks(dir);
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const TENANT_A = "0192f2b6-7a4c-7c3d-8f2a-9c1b3d4e5f60";
const TENANT_B = "0192f2b6-7a4c-7d11-b4e0-1a2b3c4d5e6f";
const CONNECTION_1 = "0192f2b6-7a4c-7e22-9f10-2b3c4d5e6f70";
const CONNECTION_2 = "0192f2b6-7a4c-7f33-a021-3c4d5e6f7081";

describe("createVault — seal e open", () => {
  it("open(seal(x)) devolve x, para textos de tamanhos variados incluindo unicode", () => {
    const vault = createVault(kekSetWith(1));
    const samples = ["a", "uma-api-key-qualquer-123", "üñíçødé 🔐 segredo", "x".repeat(5000), ""];

    for (const plaintext of samples) {
      const sealed = vault.seal(TENANT_A, CONNECTION_1, plaintext);
      expect(vault.open(TENANT_A, CONNECTION_1, sealed)).toBe(plaintext);
    }
  });

  it("registra a versão de KEK corrente e os quatro últimos caracteres", () => {
    const vault = createVault(kekSetWith(1, 2));
    const sealed = vault.seal(TENANT_A, CONNECTION_1, "chave-secreta-9876");

    expect(sealed.keyVersion).toBe(2);
    expect(sealed.last4).toBe("9876");
  });

  it("o mesmo texto claro em dois tenants produz envelopes diferentes", () => {
    const vault = createVault(kekSetWith(1));
    const plaintext = "mesma-credencial-para-dois-escritorios";

    const sealedA = vault.seal(TENANT_A, CONNECTION_1, plaintext);
    const sealedB = vault.seal(TENANT_B, CONNECTION_1, plaintext);

    expect(sealedA.secretEnvelope.equals(sealedB.secretEnvelope)).toBe(false);
    expect(sealedA.dekEnvelope.equals(sealedB.dekEnvelope)).toBe(false);
  });

  it("envelope de um tenant não abre sob outro tenant (AAD falha)", () => {
    const vault = createVault(kekSetWith(1));
    const sealed = vault.seal(TENANT_A, CONNECTION_1, "segredo-do-tenant-a");

    expect(() => vault.open(TENANT_B, CONNECTION_1, sealed)).toThrowError(OpenError);
  });

  it("envelope de uma conexão não abre sob outra conexão do mesmo tenant (AAD falha)", () => {
    const vault = createVault(kekSetWith(1));
    const sealed = vault.seal(TENANT_A, CONNECTION_1, "segredo-da-conexao-1");

    expect(() => vault.open(TENANT_A, CONNECTION_2, sealed)).toThrowError(OpenError);
  });

  it("erro de abertura nunca inclui o texto claro, a KEK ou os bytes do envelope", () => {
    const vault = createVault(kekSetWith(1));
    const plaintext = "valor-que-nao-pode-vazar-em-mensagem-de-erro";
    const sealed = vault.seal(TENANT_A, CONNECTION_1, plaintext);

    let caught: unknown;
    try {
      vault.open(TENANT_B, CONNECTION_1, sealed);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OpenError);
    const message = (caught as Error).message;
    expect(message).not.toContain(plaintext);
    expect(message).not.toContain(sealed.secretEnvelope.toString("hex"));
    expect(message).not.toContain(sealed.dekEnvelope.toString("hex"));
  });
});
