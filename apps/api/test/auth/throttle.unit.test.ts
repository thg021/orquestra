import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthThrottle } from "../../src/auth/throttle";
import { RateLimitedError } from "@orquestra/core";

describe("AuthThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tentativas acima do limite dentro da janela passam a ser recusadas", () => {
    const throttle = new AuthThrottle({ maxAttempts: 3, windowMs: 60_000 });
    const email = "a@b.com";

    throttle.registerFailure(email);
    throttle.registerFailure(email);
    throttle.registerFailure(email);

    expect(() => throttle.check(email)).toThrow(RateLimitedError);
  });

  it("abaixo do limite, check() não lança", () => {
    const throttle = new AuthThrottle({ maxAttempts: 3, windowMs: 60_000 });
    const email = "a@b.com";

    throttle.registerFailure(email);
    throttle.registerFailure(email);

    expect(() => throttle.check(email)).not.toThrow();
  });

  it("a janela expira e libera novas tentativas", () => {
    const throttle = new AuthThrottle({ maxAttempts: 2, windowMs: 60_000 });
    const email = "a@b.com";

    throttle.registerFailure(email);
    throttle.registerFailure(email);
    expect(() => throttle.check(email)).toThrow(RateLimitedError);

    vi.advanceTimersByTime(60_001);

    expect(() => throttle.check(email)).not.toThrow();
  });

  it("reset zera o contador", () => {
    const throttle = new AuthThrottle({ maxAttempts: 2, windowMs: 60_000 });
    const email = "a@b.com";

    throttle.registerFailure(email);
    throttle.registerFailure(email);
    expect(() => throttle.check(email)).toThrow(RateLimitedError);

    throttle.reset(email);

    expect(() => throttle.check(email)).not.toThrow();
  });

  it("a chave é normalizada — variação de caixa e espaço não contorna o limite", () => {
    const throttle = new AuthThrottle({ maxAttempts: 2, windowMs: 60_000 });

    throttle.registerFailure("A@B.com");
    throttle.registerFailure("  a@b.com  ");

    expect(() => throttle.check("a@b.com")).toThrow(RateLimitedError);
  });
});
