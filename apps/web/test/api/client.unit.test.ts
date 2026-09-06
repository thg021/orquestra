import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, ApiError, setUnauthorizedHandler } from "../../src/api/client";

function mockJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("apiFetch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    setUnauthorizedHandler(undefined);
    vi.restoreAllMocks();
  });

  it("envia credentials: include em toda requisição", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(200, { ok: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiFetch("/auth/me");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("401 durante o uso chama o handler de sessão expirada", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(401, { code: "UNAUTHORIZED", message: "Não autenticado." }));
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(apiFetch("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("login (skipUnauthorizedHandling) não dispara o handler mesmo em 401", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockJsonResponse(401, { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." }));
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(
      apiFetch("/auth/login", { method: "POST", body: { email: "a@b.com", password: "x" }, skipUnauthorizedHandling: true })
    ).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("erro de rede é distinguido de 401 e não desloga o usuário", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(apiFetch("/auth/me")).rejects.toThrow("Failed to fetch");
    expect(handler).not.toHaveBeenCalled();
  });
});
