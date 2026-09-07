import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import CatalogRoute from "../../../src/routes/catalog/catalog-route";
import { getAgents } from "../../../src/api/catalog";
import { createServiceInstance } from "../../../src/api/service-instances";

vi.mock("../../../src/api/catalog", () => ({ getAgents: vi.fn() }));
vi.mock("../../../src/api/service-instances", () => ({ createServiceInstance: vi.fn() }));

const AGENT = {
  key: "accounting-routine",
  version: "1.0.0",
  title: "Rotina contábil",
  description: "Conferência de folha e fiscal.",
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

function renderCatalog() {
  return render(
    <MemoryRouter initialEntries={["/catalog"]}>
      <Routes>
        <Route path="/catalog" element={<CatalogRoute />} />
        <Route path="/service-instances/:id" element={<div>Tela da instância</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("CatalogRoute", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("mostra as capabilities do agente, distinguindo obrigatória de opcional", async () => {
    vi.mocked(getAgents).mockResolvedValue([AGENT]);

    renderCatalog();

    await screen.findByText("Rotina contábil");
    expect(screen.getByText(/file-storage.*obrigatória/)).toBeDefined();
    expect(screen.getByText(/document-delivery.*opcional/)).toBeDefined();
  });

  it("instalar cria a instância e navega para ela", async () => {
    vi.mocked(getAgents).mockResolvedValue([AGENT]);
    vi.mocked(createServiceInstance).mockResolvedValue({
      id: "instancia-1",
      agentKey: "accounting-routine",
      agentVersion: "1.0.0",
      name: "Minha instância",
      config: {},
      status: "installed",
      statusReason: null,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z"
    });

    renderCatalog();

    fireEvent.click(await screen.findByRole("button", { name: "Instalar" }));
    fireEvent.change(screen.getByLabelText("Nome da instância"), { target: { value: "Minha instância" } });
    fireEvent.change(screen.getByLabelText("Assinatura"), { target: { value: "Escritório X" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(createServiceInstance).toHaveBeenCalledWith({
        agentKey: "accounting-routine",
        name: "Minha instância",
        config: { signature: "Escritório X" }
      })
    );
    await waitFor(() => expect(screen.queryByText("Tela da instância")).not.toBeNull());
  });
});
