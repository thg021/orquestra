import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encodeEnvelope, decodeEnvelope, InvalidEnvelopeError } from "../../src/vault/envelope";

describe("envelope", () => {
  it("decodeEnvelope(encodeEnvelope(...)) recupera IV, tag e ciphertext originais", () => {
    const iv = randomBytes(12);
    const tag = randomBytes(16);
    const ciphertext = randomBytes(37);

    const decoded = decodeEnvelope(encodeEnvelope(iv, tag, ciphertext));

    expect(decoded.iv.equals(iv)).toBe(true);
    expect(decoded.tag.equals(tag)).toBe(true);
    expect(decoded.ciphertext.equals(ciphertext)).toBe(true);
  });

  it("aceita ciphertext vazio (texto claro vazio)", () => {
    const iv = randomBytes(12);
    const tag = randomBytes(16);

    const decoded = decodeEnvelope(encodeEnvelope(iv, tag, Buffer.alloc(0)));

    expect(decoded.ciphertext.length).toBe(0);
  });

  it("recusa envelope curto demais", () => {
    expect(() => decodeEnvelope(Buffer.alloc(5))).toThrowError(InvalidEnvelopeError);
  });

  it("recusa versão de formato desconhecida", () => {
    const bogus = Buffer.concat([Buffer.from([0x99]), randomBytes(12 + 16 + 4)]);
    expect(() => decodeEnvelope(bogus)).toThrowError(InvalidEnvelopeError);
  });
});
