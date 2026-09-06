import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AppRoute from "../../src/routes/app";
import { apiFetch } from "../../src/api/client";

vi.mock("../../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/client")>("../../src/api/client");
  return { ...actual, apiFetch: vi.fn() };
});

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<AppRoute />} />
        <Route path="/login" element={<div>Tela de login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AppRoute (shell autenticado)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("mostra o nome do tenant ativo e o e-mail do usuário", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      user: { id: "1", email: "ana@exemplo.com" },
      tenant: { id: "2", name: "Escritório Acme" },
      role: "owner"
    });

    renderApp();

    await waitFor(() => expect(screen.queryByText("Escritório Acme")).not.toBeNull());
    expect(screen.queryByText("ana@exemplo.com")).not.toBeNull();
  });

  it("sair encerra a sessão e retorna ao login", async () => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/auth/me") {
        return Promise.resolve({
          user: { id: "1", email: "ana@exemplo.com" },
          tenant: { id: "2", name: "Acme" },
          role: "owner"
        });
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    const logoutButton = await screen.findByRole("button", { name: /sair/i });
    fireEvent.click(logoutButton);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/auth/logout", { method: "POST" })
    );
    await waitFor(() => expect(screen.queryByText("Tela de login")).not.toBeNull());
  });
});
