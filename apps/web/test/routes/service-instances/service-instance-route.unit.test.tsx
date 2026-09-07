import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ServiceInstanceRoute from "../../../src/routes/service-instances/service-instance-route";
import { getAgents, getConnectors } from "../../../src/api/catalog";
import { getServiceInstance, updateServiceInstance, activateServiceInstance } from "../../../src/api/service-instances";
import { listBindings } from "../../../src/api/bindings";
import { listConnections } from "../../../src/api/connections";
import { ApiError } from "../../../src/api/client";

vi.mock("../../../src/api/catalog", () => ({ getAgents: vi.fn(), getConnectors: vi.fn() }));
vi.mock("../../../src/api/service-instances", () => ({
  getServiceInstance: vi.fn(),
  updateServiceInstance: vi.fn(),
  activateServiceInstance: vi.fn(),
  pauseServiceInstance: vi.fn()
}));
vi.mock("../../../src/api/bindings", () => ({
  listBindings: vi.fn(),
  bindCapability: vi.fn(),
  unbindCapability: vi.fn()
}));
vi.mock("../../../src/api/connections", () => ({ listConnections: vi.fn() }));

const AGENT = {
  key: "accounting-routine",
  version: "1.0.0",
  title: "Rotina contábil",
  description: "x",
  capabilities: [
    { capability: "file-storage" as const, required: true },
    { capability: "document-delivery" as const, required: false }
  ],
  configSchema: {
    type: "object",
    required: ["signature"],
    properties: { signature: { type: "string", title: "Assinatura" } }
  }
};

const CONNECTOR = { key: "platform-upload", title: "Upload", capability: "file-storage" as const, kind: "native" as const, authKind: "api_key" as const, authSchema: {} };

const INSTANCE = {
  id: "inst-1",
  agentKey: "accounting-routine",
  agentVersion: "1.0.0",
  name: "Minha instância",
  config: { signature: "Original" },
  status: "installed",
  statusReason: null,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z"
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

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/service-instances/inst-1"]}>
      <Routes>
        <Route path="/service-instances/:id" element={<ServiceInstanceRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ServiceInstanceRoute", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("mostra cada capability com o vínculo atual e a marcação de obrigatória", async () => {
    vi.mocked(getServiceInstance).mockResolvedValue(INSTANCE);
    vi.mocked(getAgents).mockResolvedValue([AGENT]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(listConnections).mockResolvedValue([CONNECTION]);
    vi.mocked(listBindings).mockResolvedValue([{ capability: "file-storage", connectionId: "conn-1" }]);

    renderRoute();

    await screen.findByText("Minha instância");
    fireEvent.click(screen.getByRole("button", { name: "Conexões" }));

    expect(screen.getByText(/file-storage/)).toBeDefined();
    expect(screen.getByText(/obrigatória/)).toBeDefined();
    expect(screen.getByText(/vinculada a "Conta principal"/)).toBeDefined();
    expect(screen.getByText(/não vinculada/)).toBeDefined();
  });

  it("recusa de ativação vira lista nomeada, com botão para a aba onde se resolve", async () => {
    vi.mocked(getServiceInstance).mockResolvedValue(INSTANCE);
    vi.mocked(getAgents).mockResolvedValue([AGENT]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(listConnections).mockResolvedValue([]);
    vi.mocked(listBindings).mockResolvedValue([]);
    vi.mocked(activateServiceInstance).mockRejectedValue(
      new ApiError(409, "ACTIVATION_BLOCKED", "Não é possível ativar.", undefined, [
        { code: "CAPABILITY_UNBOUND", capabilities: ["file-storage"] }
      ])
    );

    renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Ativar" }));

    await screen.findByText(/Capability obrigatória sem vínculo: file-storage/);

    fireEvent.click(screen.getByRole("button", { name: "Resolver" }));
    expect(screen.getByRole("button", { name: "Conexões" }).getAttribute("aria-current")).toBe("true");
  });

  it("configuração salva sobrevive a recarregar a página", async () => {
    vi.mocked(getServiceInstance).mockResolvedValueOnce(INSTANCE);
    vi.mocked(getAgents).mockResolvedValue([AGENT]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(listConnections).mockResolvedValue([]);
    vi.mocked(listBindings).mockResolvedValue([]);
    vi.mocked(updateServiceInstance).mockResolvedValue({ ...INSTANCE, config: { signature: "Nova assinatura" } });

    renderRoute();

    const signatureInput = await screen.findByLabelText("Assinatura");
    fireEvent.change(signatureInput, { target: { value: "Nova assinatura" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateServiceInstance).toHaveBeenCalledWith("inst-1", { config: { signature: "Nova assinatura" } })
    );

    // A "recarregada" busca de novo no servidor (não em estado local) — é isso que
    // prova que sobreviveria a um F5 de verdade.
    vi.mocked(getServiceInstance).mockResolvedValueOnce({ ...INSTANCE, config: { signature: "Nova assinatura" } });
    cleanup();
    renderRoute();

    const reloadedInput = (await screen.findByLabelText("Assinatura")) as HTMLInputElement;
    expect(reloadedInput.value).toBe("Nova assinatura");
  });
});
