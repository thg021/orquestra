import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadKeks } from "../../src/vault/kek";
import { createVault, OpenError } from "../../src/vault/seal";

let dir: string | undefined;

function kekSetWith(...versions: number[]) {
  dir = mkdtempSync(join(tmpdir(), "orquestra-rewrap-"));
  for (const version of versions) {
    writeFileSync(join(dir, String(version)), randomBytes(32));
  }
  return loadKeks(dir);
}

/**
 * Simula a rotação de verdade: sela com só a versão antiga disponível (como o boot
 * via antes de rotacionar), depois monta um cofre com a versão nova também presente
 * (como o boot vê depois que o operador monta a KEK nova). Sem isso, `seal` usaria
 * sempre a versão mais alta do conjunto, e nenhum teste estaria provando rotação.
 */
function sealThenAddVersion(plaintext: string, tenantId: string, connectionId: string, newVersion: number) {
  const vaultOld = createVault(kekSetWith(1));
  const sealed = vaultOld.seal(tenantId, connectionId, plaintext);
  if (!dir) throw new Error("dir não inicializado");
  writeFileSync(join(dir, String(newVersion)), randomBytes(32));
  const vaultWithBoth = createVault(loadKeks(dir));
  return { sealed, vaultWithBoth };
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const TENANT = "0192f2b6-7a4c-7c3d-8f2a-9c1b3d4e5f60";
const CONNECTION = "0192f2b6-7a4c-7e22-9f10-2b3c4d5e6f70";

describe("rewrapDek", () => {
  it("depois de recifrar, open continua devolvendo o mesmo texto claro", () => {
    const { sealed, vaultWithBoth } = sealThenAddVersion("credencial-original", TENANT, CONNECTION, 2);

    const rewrapped = vaultWithBoth.rewrapDek(TENANT, CONNECTION, sealed, 2);

    expect(vaultWithBoth.open(TENANT, CONNECTION, rewrapped)).toBe("credencial-original");
  });

  it("o secret_envelope é byte a byte idêntico ao anterior — nunca é tocado", () => {
    const { sealed, vaultWithBoth } = sealThenAddVersion("credencial-original", TENANT, CONNECTION, 2);

    const rewrapped = vaultWithBoth.rewrapDek(TENANT, CONNECTION, sealed, 2);

    expect(rewrapped.secretEnvelope.equals(sealed.secretEnvelope)).toBe(true);
  });

  it("o dek_envelope muda, e a versão registrada passa a ser a nova", () => {
    const { sealed, vaultWithBoth } = sealThenAddVersion("credencial-original", TENANT, CONNECTION, 2);
    expect(sealed.keyVersion).toBe(1);

    const rewrapped = vaultWithBoth.rewrapDek(TENANT, CONNECTION, sealed, 2);

    expect(rewrapped.dekEnvelope.equals(sealed.dekEnvelope)).toBe(false);
    expect(rewrapped.keyVersion).toBe(2);
  });

  it("preserva o last4", () => {
    const { sealed, vaultWithBoth } = sealThenAddVersion("chave-1234", TENANT, CONNECTION, 2);

    const rewrapped = vaultWithBoth.rewrapDek(TENANT, CONNECTION, sealed, 2);

    expect(rewrapped.last4).toBe("1234");
  });

  it("conexão ainda em v1 (não recifrada) e conexão já em v2 (recifrada) convivem legíveis sob o mesmo conjunto de KEKs", () => {
    const { sealed: aindaV1, vaultWithBoth } = sealThenAddVersion("segredo-que-fica-em-v1", TENANT, CONNECTION, 2);
    const outraSeladaV1 = vaultWithBoth.seal(TENANT, "0192f2b6-7a4c-7f33-a021-3c4d5e6f7081", "segredo-a-recifrar");
    const recifrada = vaultWithBoth.rewrapDek(TENANT, "0192f2b6-7a4c-7f33-a021-3c4d5e6f7081", outraSeladaV1, 2);

    expect(vaultWithBoth.open(TENANT, CONNECTION, aindaV1)).toBe("segredo-que-fica-em-v1");
    expect(vaultWithBoth.open(TENANT, "0192f2b6-7a4c-7f33-a021-3c4d5e6f7081", recifrada)).toBe(
      "segredo-a-recifrar"
    );
  });

  it("recifrar sob uma versão de KEK que não existe lança, sem corromper o envelope original", () => {
    const vault = createVault(kekSetWith(1));
    const sealed = vault.seal(TENANT, CONNECTION, "credencial-original");

    expect(() => vault.rewrapDek(TENANT, CONNECTION, sealed, 99)).toThrow();
    expect(vault.open(TENANT, CONNECTION, sealed)).toBe("credencial-original");
  });

  it("repetir o rewrap sobre o mesmo envelope original dá, nas duas vezes, um resultado utilizável", () => {
    const { sealed, vaultWithBoth } = sealThenAddVersion("credencial-original", TENANT, CONNECTION, 2);

    const primeiraTentativa = vaultWithBoth.rewrapDek(TENANT, CONNECTION, sealed, 2);
    const segundaTentativa = vaultWithBoth.rewrapDek(TENANT, CONNECTION, sealed, 2);

    expect(vaultWithBoth.open(TENANT, CONNECTION, primeiraTentativa)).toBe("credencial-original");
    expect(vaultWithBoth.open(TENANT, CONNECTION, segundaTentativa)).toBe("credencial-original");
  });

  it("não abre com a versão antiga forçada — prova que o rewrap trocou a versão de verdade", () => {
    const { sealed, vaultWithBoth } = sealThenAddVersion("credencial-original", TENANT, CONNECTION, 2);
    const rewrapped = vaultWithBoth.rewrapDek(TENANT, CONNECTION, sealed, 2);

    const comVersaoAntigaForcada = { ...rewrapped, keyVersion: 1 };
    expect(() => vaultWithBoth.open(TENANT, CONNECTION, comVersaoAntigaForcada)).toThrowError(OpenError);
  });
});
