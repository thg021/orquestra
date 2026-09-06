import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginRoute from "../../src/routes/login";
import { apiFetch, ApiError } from "../../src/api/client";

vi.mock("../../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/client")>("../../src/api/client");
  return { ...actual, apiFetch: vi.fn() };
});

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginRoute />
    </MemoryRouter>
  );
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /entrar/i }));
}

describe("LoginRoute", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("credencial válida navega para o shell", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      user: { id: "1", email: "a@b.com" },
      tenant: { id: "2", name: "Acme" },
      role: "owner"
    });

    renderLogin();
    fillAndSubmit("a@b.com", "senha-correta");

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("falha exibe mensagem genérica, sem revelar se o e-mail existe", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos."));

    renderLogin();
    fillAndSubmit("a@b.com", "senha-errada");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("E-mail ou senha inválidos.");
    expect(alert.textContent).not.toMatch(/existe|cadastrad/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("o botão fica desabilitado durante o envio, impedindo duplo submit", async () => {
    let resolveLogin!: () => void;
    vi.mocked(apiFetch).mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = () =>
          resolve({ user: { id: "1", email: "a@b.com" }, tenant: { id: "2", name: "Acme" }, role: "owner" });
      })
    );

    renderLogin();
    fillAndSubmit("a@b.com", "senha-correta");

    const button = screen.getByRole("button", { name: /entrando/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    resolveLogin();
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });

  it("o campo de senha não é persistido em localStorage nem sessionStorage", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos."));

    renderLogin();
    fillAndSubmit("a@b.com", "senha-super-secreta");

    await screen.findByRole("alert");

    expect(JSON.stringify(window.localStorage)).not.toContain("senha-super-secreta");
    expect(JSON.stringify(window.sessionStorage)).not.toContain("senha-super-secreta");
  });

  it("envia e-mail e senha exatamente como digitados, com skipUnauthorizedHandling", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      user: { id: "1", email: "a@b.com" },
      tenant: { id: "2", name: "Acme" },
      role: "owner"
    });

    renderLogin();
    fillAndSubmit("a@b.com", "senha-correta");

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({
        method: "POST",
        body: { email: "a@b.com", password: "senha-correta" },
        skipUnauthorizedHandling: true
      })
    );
  });
});
