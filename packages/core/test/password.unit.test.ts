import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, assertPasswordPolicy, MIN_PASSWORD_LENGTH } from "../src/password";
import { WeakPasswordError } from "../src/errors";

// Custo mínimo aceito pela lib (1024 KiB, 2 iterações) — só para manter o teste rápido.
const TEST_COST = { memoryCost: 1024, timeCost: 2, parallelism: 1 };

describe("hashPassword / verifyPassword", () => {
  it("dois hashes da mesma senha diferem entre si (sal por usuário)", async () => {
    const a = await hashPassword("senha-correta-123", TEST_COST);
    const b = await hashPassword("senha-correta-123", TEST_COST);
    expect(a).not.toBe(b);
  });

  it("ambos os hashes verificam contra a senha original", async () => {
    const hash = await hashPassword("senha-correta-123", TEST_COST);
    expect(await verifyPassword("senha-correta-123", hash)).toBe(true);
  });

  it("verifyPassword devolve falso para senha errada", async () => {
    const hash = await hashPassword("senha-correta-123", TEST_COST);
    expect(await verifyPassword("senha-errada-456", hash)).toBe(false);
  });

  it("verifyPassword não lança para hash malformado", async () => {
    await expect(verifyPassword("qualquer-coisa", "isto-nao-e-um-hash-argon2")).resolves.toBe(false);
  });

  it("o hash não contém a senha em texto claro", async () => {
    const plain = "senha-correta-123";
    const hash = await hashPassword(plain, TEST_COST);
    expect(hash).not.toContain(plain);
  });

  it("assertPasswordPolicy recusa senha abaixo do mínimo antes de qualquer hash", () => {
    expect(() => assertPasswordPolicy("curta")).toThrow(WeakPasswordError);
    expect(() => assertPasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });
});
