import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Diretório de KEK válido pra teste — uma versão, chave aleatória de 32 bytes. */
export function createTestKekDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "orquestra-test-kek-"));
  writeFileSync(join(dir, "1"), randomBytes(32));
  return dir;
}
