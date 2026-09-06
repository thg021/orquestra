import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { DomainError } from "../errors";
import { encodeEnvelope, decodeEnvelope } from "./envelope";

const ALGORITHM = "aes-256-gcm";
// Separador improvável de aparecer num UUID — impede que tenant="a" + connection="bc"
// colida com tenant="ab" + connection="c" na hora de montar o AAD.
const AAD_SEPARATOR = "␟";

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

/**
 * AAD da DEK amarra tenant, conexão E a versão de KEK que a envelopa — é o que muda
 * no rewrap. AAD do segredo amarra só tenant e conexão: a DEK em si nunca muda numa
 * rotação, então o secret_envelope (cifrado pela DEK) não pode depender de uma versão
 * de KEK que é conceito de uma camada acima (D34).
 */
export function dekAad(tenantId: string, connectionId: string, keyVersion: number): Buffer {
  return Buffer.from(`${tenantId}${AAD_SEPARATOR}${connectionId}${AAD_SEPARATOR}${keyVersion}`, "utf8");
}

export function secretAad(tenantId: string, connectionId: string): Buffer {
  return Buffer.from(`${tenantId}${AAD_SEPARATOR}${connectionId}`, "utf8");
}

export function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encodeEnvelope(iv, cipher.getAuthTag(), ciphertext);
}

export function decrypt(key: Buffer, envelope: Buffer, aad: Buffer): Buffer {
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
