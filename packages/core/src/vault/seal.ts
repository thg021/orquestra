import { randomBytes } from "node:crypto";
import { DomainError } from "../errors";
import type { KekSet } from "./kek";
import { deriveTenantKey } from "./derive-tenant-key";
import { encrypt, decrypt, dekAad, secretAad } from "./gcm";
import { rewrapDek } from "./rewrap";

const DEK_LENGTH = 32;

export { OpenError } from "./gcm";

export class SealError extends DomainError {
  constructor(message: string) {
    super("VAULT_SEAL_FAILED", message);
  }
}

export interface SealedSecret {
  readonly secretEnvelope: Buffer;
  readonly dekEnvelope: Buffer;
  /** Versão de KEK usada para cifrar a DEK — é o que `rewrapDek` muda. */
  readonly keyVersion: number;
  readonly last4: string;
}

export interface Vault {
  seal(tenantId: string, connectionId: string, plaintext: string): SealedSecret;
  open(tenantId: string, connectionId: string, sealed: SealedSecret): string;
  /** Recifra a DEK sob outra versão de KEK. Nunca toca `secretEnvelope`. */
  rewrapDek(tenantId: string, connectionId: string, sealed: SealedSecret, toVersion: number): SealedSecret;
}

/** Cria um cofre ligado a um conjunto de KEKs — é o que `seal`/`open` usam por baixo. */
export function createVault(keks: KekSet): Vault {
  return {
    seal(tenantId, connectionId, plaintext) {
      try {
        const keyVersion = keks.currentVersion;
        const kek = keks.get(keyVersion);
        const tenantKey = deriveTenantKey(kek, tenantId, keyVersion);

        const dek = randomBytes(DEK_LENGTH);
        const dekEnvelope = encrypt(tenantKey, dek, dekAad(tenantId, connectionId, keyVersion));

        const plaintextBuffer = Buffer.from(plaintext, "utf8");
        const secretEnvelope = encrypt(dek, plaintextBuffer, secretAad(tenantId, connectionId));

        return { secretEnvelope, dekEnvelope, keyVersion, last4: plaintext.slice(-4) };
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new SealError("Falha ao cifrar o segredo.");
      }
    },

    open(tenantId, connectionId, sealed) {
      const kek = keks.get(sealed.keyVersion);
      const tenantKey = deriveTenantKey(kek, tenantId, sealed.keyVersion);

      const dek = decrypt(tenantKey, sealed.dekEnvelope, dekAad(tenantId, connectionId, sealed.keyVersion));
      const plaintextBuffer = decrypt(dek, sealed.secretEnvelope, secretAad(tenantId, connectionId));

      return plaintextBuffer.toString("utf8");
    },

    rewrapDek(tenantId, connectionId, sealed, toVersion) {
      return rewrapDek(keks, tenantId, connectionId, sealed, toVersion);
    }
  };
}
