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
      user: { id: "11111111-1111-1111-1111-111111111111", email: "a@b.com" },
      tenant: { id: "22222222-2222-2222-2222-222222222222", name: "Acme" },
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
