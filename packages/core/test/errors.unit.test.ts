import { describe, it, expect } from "vitest";
import {
  DomainError,
  DuplicateTenantNameError,
  WeakPasswordError,
  LastOwnerError,
  InvalidCredentialsError,
  NoMembershipError,
  InsufficientRoleError,
  RateLimitedError
} from "../src/errors";

function allErrorInstances(): DomainError[] {
  return [
    new DuplicateTenantNameError("acme"),
    new WeakPasswordError(12),
    new LastOwnerError(),
    new InvalidCredentialsError(),
    new NoMembershipError(),
    new InsufficientRoleError(),
    new RateLimitedError()
  ];
}

describe("erros de domínio", () => {
  it("são instâncias reais de Error com nome igual ao da classe", () => {
    const error = new LastOwnerError();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe("LastOwnerError");
  });

  it("carregam um código estável e não vazio", () => {
    const error = new InvalidCredentialsError();
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(error.code.length).toBeGreaterThan(0);
  });

  it("cada classe de erro de domínio tem um código único, sem colisão", () => {
    const codes = allErrorInstances().map((instance) => instance.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
