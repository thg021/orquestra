import { randomBytes } from "node:crypto";

const RAND_BITS = 74n; // 12 bits (rand_a) + 62 bits (rand_b)
const RAND_MAX = (1n << RAND_BITS) - 1n;

let lastTimestampMs = -1n;
let lastRandom = 0n;

function randomBigInt(bits: bigint): bigint {
  const byteLength = Number((bits + 7n) / 8n);
  const bytes = randomBytes(byteLength);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  const excessBits = BigInt(byteLength * 8) - bits;
  return value >> excessBits;
}

/**
 * UUID v7 (RFC 9562): 48 bits de timestamp em milissegundos, versão, 12+62 bits
 * aleatórios. Não sequencial (não revela contagem de tenants/registros), mas
 * ordenável por tempo — o que preserva localidade de índice.
 *
 * Dentro do mesmo milissegundo, incrementa a cauda aleatória em vez de sortear de
 * novo (método "monotonic random" da RFC), garantindo ordem estritamente crescente
 * mesmo com múltiplas chamadas no mesmo tick.
 */
export function newId(): string {
  const nowMs = BigInt(Date.now());

  let timestampMs = nowMs;
  let rand: bigint;

  if (timestampMs <= lastTimestampMs) {
    timestampMs = lastTimestampMs;
    rand = lastRandom + 1n;
    if (rand > RAND_MAX) {
      // Envolveu o espaço aleatório dentro do mesmo ms: avança o relógio lógico.
      timestampMs += 1n;
      rand = randomBigInt(RAND_BITS);
    }
  } else {
    rand = randomBigInt(RAND_BITS);
  }

  lastTimestampMs = timestampMs;
  lastRandom = rand;

  const randA = (rand >> 62n) & 0xfffn;
  const randB = rand & 0x3fffffffffffffffn;

  let value = timestampMs & 0xffffffffffffn; // 48 bits
  value = (value << 4n) | 0x7n; // versão 7
  value = (value << 12n) | randA;
  value = (value << 2n) | 0x2n; // variante RFC 4122 (10)
  value = (value << 62n) | randB;

  const hex = value.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
