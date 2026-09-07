import { DomainError } from "../errors";

// Versão do FORMATO do envelope (não a versão da KEK — essa vai à parte, em
// `SealedSecret.keyVersion`, porque rotacionar a KEK não deve mexer no formato).
const FORMAT_VERSION = 0x01;
const IV_LENGTH = 12; // 96 bits, recomendado para GCM
const TAG_LENGTH = 16; // 128 bits

export class InvalidEnvelopeError extends DomainError {
  constructor(message: string) {
    super("INVALID_ENVELOPE", message);
  }
}

/**
 * Formato binário único para segredo e para DEK: `versão‖IV‖tag‖ciphertext`. Um
 * `bytea` só em vez de colunas soltas — impossível gravar metade e criar uma linha
 * irrecuperável.
 */
export function encodeEnvelope(iv: Buffer, tag: Buffer, ciphertext: Buffer): Buffer {
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, tag, ciphertext]);
}

export interface DecodedEnvelope {
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
}

export function decodeEnvelope(envelope: Buffer): DecodedEnvelope {
  const minLength = 1 + IV_LENGTH + TAG_LENGTH;
  if (envelope.length < minLength) {
    throw new InvalidEnvelopeError(`Envelope curto demais (esperado ao menos ${minLength} bytes).`);
  }
  if (envelope[0] !== FORMAT_VERSION) {
    throw new InvalidEnvelopeError(`Versão de envelope desconhecida: ${envelope[0]}.`);
  }
  return {
    iv: envelope.subarray(1, 1 + IV_LENGTH),
    tag: envelope.subarray(1 + IV_LENGTH, minLength),
    ciphertext: envelope.subarray(minLength)
  };
}
