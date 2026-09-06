import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "../../src/components/protected-route";
import { apiFetch, ApiError } from "../../src/api/client";

vi.mock("../../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/client")>("../../src/api/client");
  return { ...actual, apiFetch: vi.fn() };
});

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={<ProtectedRoute>{(me) => <div>Olá, {me.user.email}</div>}</ProtectedRoute>}
        />
        <Route path="/login" element={<div>Tela de login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("mostra estado de carregamento antes de resolver a checagem de sessão", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    renderProtected();

    expect(screen.getByRole("status").textContent).toBe("Carregando…");
    expect(screen.queryByText("Tela de login")).toBeNull();
  });

  it("visitante não autenticado é redirecionado ao login", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Não autenticado."));

    renderProtected();

    await waitFor(() => expect(screen.queryByText("Tela de login")).not.toBeNull());
  });

  it("autenticado renderiza o conteúdo com os dados de /auth/me", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      user: { id: "1", email: "ana@exemplo.com" },
      tenant: { id: "2", name: "Acme" },
      role: "owner"
    });

    renderProtected();

    await waitFor(() => expect(screen.queryByText("Olá, ana@exemplo.com")).not.toBeNull());
  });

  it("erro de rede na checagem inicial também leva ao login, sem travar em carregamento", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new TypeError("Failed to fetch"));

    renderProtected();

    await waitFor(() => expect(screen.queryByText("Tela de login")).not.toBeNull());
  });

  it("consulta /auth/me com skipUnauthorizedHandling, sem disparar o handler global", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      user: { id: "1", email: "ana@exemplo.com" },
      tenant: { id: "2", name: "Acme" },
      role: "owner"
    });

    renderProtected();

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/auth/me", { skipUnauthorizedHandling: true }));
  });
});
