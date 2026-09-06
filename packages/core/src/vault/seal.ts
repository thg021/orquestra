import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { DomainError } from "../errors";
import type { KekSet } from "./kek";
import { deriveTenantKey } from "./derive-tenant-key";
import { encodeEnvelope, decodeEnvelope } from "./envelope";

const DEK_LENGTH = 32;
const ALGORITHM = "aes-256-gcm";
// Separador improvável de aparecer num UUID — impede que tenant="a" + connection="bc"
// colida com tenant="ab" + connection="c" na hora de montar o AAD.
const AAD_SEPARATOR = "␟";

export class SealError extends DomainError {
  constructor(message: string) {
    super("VAULT_SEAL_FAILED", message);
  }
}

/**
 * Falha ao abrir um envelope — autenticação do GCM não confere. Acontece com tenant
 * errado, conexão errada, versão de KEK errada, ou dado corrompido. A mensagem nunca
 * inclui texto claro, chave nem bytes do envelope (ADR-001).
 */
export class OpenError extends DomainError {
  constructor(message: string) {
    super("VAULT_OPEN_FAILED", message);
  }
}

export interface SealedSecret {
  readonly secretEnvelope: Buffer;
  readonly dekEnvelope: Buffer;
  /** Versão de KEK usada para cifrar a DEK — é o que `rewrapDek` (T7) muda. */
  readonly keyVersion: number;
  readonly last4: string;
}

export interface Vault {
  seal(tenantId: string, connectionId: string, plaintext: string): SealedSecret;
  open(tenantId: string, connectionId: string, sealed: SealedSecret): string;
}

/**
 * AAD da DEK amarra tenant, conexão E a versão de KEK que a envelopa — é o que muda
 * quando `rewrapDek` roda. AAD do segredo amarra só tenant e conexão: a DEK em si
 * nunca muda na rotação, então o secret_envelope (cifrado pela DEK) não pode depender
 * de uma versão de KEK que é conceito de uma camada acima — se dependesse, rotacionar
 * a KEK exigiria recifrar o segredo também, quebrando a promessa de "sem tocar o
 * secret_envelope" (design §Fluxos).
 */
function dekAad(tenantId: string, connectionId: string, keyVersion: number): Buffer {
  return Buffer.from(`${tenantId}${AAD_SEPARATOR}${connectionId}${AAD_SEPARATOR}${keyVersion}`, "utf8");
}

function secretAad(tenantId: string, connectionId: string): Buffer {
  return Buffer.from(`${tenantId}${AAD_SEPARATOR}${connectionId}`, "utf8");
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encodeEnvelope(iv, cipher.getAuthTag(), ciphertext);
}

function decrypt(key: Buffer, envelope: Buffer, aad: Buffer): Buffer {
  const { iv, tag, ciphertext } = decodeEnvelope(envelope);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Nunca repassar o erro nativo: ele pode ecoar parte do buffer em alguns runtimes.
    throw new OpenError("Falha ao abrir o envelope: autenticação não confere.");
  }
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
    }
  };
}
