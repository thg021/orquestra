import { describe, it, expect } from "vitest";
import { loginRequestSchema, meResponseSchema } from "../src/auth";

describe("loginRequestSchema", () => {
  it("aceita e-mail e senha válidos", () => {
    const result = loginRequestSchema.safeParse({ email: "a@b.com", password: "qualquer" });
    expect(result.success).toBe(true);
  });

  it("recusa e-mail inválido", () => {
    const result = loginRequestSchema.safeParse({ email: "nao-e-email", password: "qualquer" });
    expect(result.success).toBe(false);
  });

  it("recusa senha vazia", () => {
    const result = loginRequestSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("meResponseSchema", () => {
  it("expõe usuário, tenant ativo e papel", () => {
    const result = meResponseSchema.safeParse({
      // UUID v7 de verdade (versão 7, variante RFC 9562) — é o que newId gera.
      user: { id: "0192f2b6-7a4c-7c3d-8f2a-9c1b3d4e5f60", email: "a@b.com" },
      tenant: { id: "0192f2b6-7a4c-7d11-b4e0-1a2b3c4d5e6f", name: "Acme" },
      role: "owner"
    });
    expect(result.success).toBe(true);
  });

  it("não tem nenhum campo de credencial no schema", () => {
    const keys = Object.keys(meResponseSchema.shape);
    expect(keys).not.toContain("password");
    expect(keys).not.toContain("passwordHash");
    expect(keys).not.toContain("token");
  });
});
