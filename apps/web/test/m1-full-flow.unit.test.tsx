import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import CatalogRoute from "../src/routes/catalog/catalog-route";
import ServiceInstanceRoute from "../src/routes/service-instances/service-instance-route";
import { apiFetch } from "../src/api/client";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../src/api/client")>("../src/api/client");
  return { ...actual, apiFetch: vi.fn() };
});

const AGENT = {
  key: "accounting-routine",
  version: "1.0.0",
  title: "Rotina contábil",
  description: "Conferência de folha e fiscal.",
  capabilities: [
    { capability: "file-storage", required: true },
    { capability: "email", required: true }
  ],
  configSchema: {
    type: "object",
    required: ["signature"],
    properties: { signature: { type: "string", title: "Assinatura" } }
  }
};

const CONNECTOR = {
  key: "platform-upload",
  title: "Upload direto na plataforma",
  capability: "file-storage",
  kind: "native",
  authKind: "api_key",
  authSchema: {}
};

const EMAIL_CONNECTOR = {
  key: "gmail",
  title: "Gmail",
  capability: "email",
  kind: "native",
  authKind: "oauth",
  authSchema: {}
};

const CONNECTION = {
  id: "conn-1",
  connectorKey: "platform-upload",
  name: "Conta principal",
  metadata: {},
  last4: "1234",
  status: "active",
  lastCheckStatus: "unverified",
  lastCheckAt: null,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z"
};

const EMAIL_CONNECTION = { ...CONNECTION, id: "conn-2", connectorKey: "gmail", name: "Conta de e-mail" };

/**
 * T25 — percurso e2e do painel: catálogo → instalar → configurar → conectar → ativar.
 * Um único `apiFetch` mockado por rota (não por função de cliente) prova que o
 * roteamento de verdade (navegação real entre `CatalogRoute` e `ServiceInstanceRoute`,
 * não troca de prop) está ligado ponta a ponta, não só cada tela isolada.
 */
function App() {
  return (
    <MemoryRouter initialEntries={["/catalog"]}>
      <Routes>
        <Route path="/catalog" element={<CatalogRoute />} />
        <Route path="/service-instances/:id" element={<ServiceInstanceRoute />} />
        <Route path="*" element={<Navigate to="/catalog" replace />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("M1 — percurso completo (T25)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("instalar → configurar → conectar → ativar, sem tocar código de agente específico", async () => {
    let instanceStatus: "installed" | "active" = "installed";
    let instanceConfig: Record<string, unknown> = {};
    const bindings: { capability: string; connectionId: string }[] = [];

    vi.mocked(apiFetch).mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      const method = options?.method ?? "GET";

      if (path === "/catalog/agents") return Promise.resolve([AGENT]);
      if (path === "/catalog/connectors") return Promise.resolve([CONNECTOR, EMAIL_CONNECTOR]);
      if (path === "/connections") return Promise.resolve([CONNECTION, EMAIL_CONNECTION]);

      if (path === "/service-instances" && method === "POST") {
        instanceConfig = (options?.body as { config: Record<string, unknown> }).config;
        return Promise.resolve({
          id: "inst-1",
          agentKey: "accounting-routine",
          agentVersion: "1.0.0",
          name: "Minha instância",
          config: instanceConfig,
          status: instanceStatus,
          statusReason: null,
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:00:00.000Z"
        });
      }

      if (path === "/service-instances/inst-1") {
        return Promise.resolve({
          id: "inst-1",
          agentKey: "accounting-routine",
          agentVersion: "1.0.0",
          name: "Minha instância",
          config: instanceConfig,
          status: instanceStatus,
          statusReason: null,
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:00:00.000Z"
        });
      }

      if (path === "/service-instances/inst-1/bindings") return Promise.resolve([...bindings]);

      if (path.startsWith("/service-instances/inst-1/bindings/") && method === "PUT") {
        const capability = path.split("/").pop() as string;
        bindings.push({ capability, connectionId: (options?.body as { connectionId: string }).connectionId });
        return Promise.resolve(undefined);
      }

      if (path === "/service-instances/inst-1/activate" && method === "POST") {
        if (bindings.length < 2) {
          return Promise.reject(new Error("não deveria ativar sem os dois vínculos"));
        }
        instanceStatus = "active";
        return Promise.resolve({
          id: "inst-1",
          agentKey: "accounting-routine",
          agentVersion: "1.0.0",
          name: "Minha instância",
          config: instanceConfig,
          status: instanceStatus,
          statusReason: null,
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:00:00.000Z"
        });
      }

      return Promise.reject(new Error(`rota não mapeada no teste: ${method} ${path}`));
    });

    render(<App />);

    // Catálogo → instalar.
    await screen.findByText("Rotina contábil");
    fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
    fireEvent.change(screen.getByLabelText("Nome da instância"), { target: { value: "Minha instância" } });
    fireEvent.change(screen.getByLabelText("Assinatura"), { target: { value: "Escritório X" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    // Navegou de verdade para a tela da instância recém-criada.
    await screen.findByText("Minha instância");
    expect(screen.getByText("Status: installed")).toBeDefined();

    // Conectar — aba Conexões, vincula as duas capabilities obrigatórias.
    fireEvent.click(screen.getByRole("button", { name: "Conexões" }));
    await screen.findByLabelText("Conexão para file-storage");

    const selects = screen.getAllByLabelText(/Conexão para/);
    fireEvent.change(selects[0]!, { target: { value: "conn-1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Vincular" })[0]!);
    await waitFor(() => expect(bindings).toHaveLength(1));

    fireEvent.change(await screen.findByLabelText("Conexão para email"), { target: { value: "conn-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));
    await waitFor(() => expect(bindings).toHaveLength(2));

    // Ativar.
    fireEvent.click(screen.getByRole("button", { name: "Ativar" }));
    await waitFor(() => expect(screen.getByText("Status: active")).toBeDefined());
  });
});
