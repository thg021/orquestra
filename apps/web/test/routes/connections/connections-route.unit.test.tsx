import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ConnectionsRoute from "../../../src/routes/connections/connections-route";
import { getConnectors } from "../../../src/api/catalog";
import {
  listConnections,
  createConnection,
  revokeConnection,
  checkConnection,
  replaceConnectionSecret
} from "../../../src/api/connections";
import { ApiError } from "../../../src/api/client";

vi.mock("../../../src/api/catalog", () => ({ getConnectors: vi.fn() }));
vi.mock("../../../src/api/connections", () => ({
  listConnections: vi.fn(),
  createConnection: vi.fn(),
  replaceConnectionSecret: vi.fn(),
  revokeConnection: vi.fn(),
  checkConnection: vi.fn()
}));

const CONNECTOR = {
  key: "platform-upload",
  title: "Upload direto na plataforma",
  capability: "file-storage" as const,
  kind: "native" as const,
  authKind: "api_key" as const,
  authSchema: { type: "object", required: ["apiKey"], properties: { apiKey: { type: "string", secret: true, title: "Chave" } } }
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
    <MemoryRouter>
      <ConnectionsRoute />
    </MemoryRouter>
  );
}

describe("ConnectionsRoute", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("não mostra em nenhum lugar o valor de um segredo — só last4 e o campo de criação vem mascarado", async () => {
    vi.mocked(listConnections).mockResolvedValue([CONNECTION]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);

    renderRoute();

    await screen.findByText("Conta principal");
    expect(screen.getByText(/\*\*\*\*1234/)).toBeDefined();

    fireEvent.change(screen.getByLabelText("Fornecedor"), { target: { value: "platform-upload" } });
    const secretInput = screen.getByLabelText("Chave") as HTMLInputElement;
    expect(secretInput.type).toBe("password");
  });

  it("conexão nunca verificada é distinguível de verificada (com data)", async () => {
    vi.mocked(listConnections).mockResolvedValue([
      CONNECTION,
      { ...CONNECTION, id: "conn-2", name: "Já checada", lastCheckAt: "2026-09-06T10:00:00.000Z" }
    ]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);

    renderRoute();

    await screen.findByText("Conta principal");
    expect(screen.getByText(/Nunca verificada/)).toBeDefined();
    expect(screen.getByText(/pendente desde 2026-09-06T10:00:00.000Z/)).toBeDefined();
  });

  it("revogar avisa quantos serviços foram pausados", async () => {
    vi.mocked(listConnections).mockResolvedValue([CONNECTION]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(revokeConnection).mockResolvedValue({ ...CONNECTION, status: "revoked", pausedInstanceCount: 2 });

    renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Revogar" }));

    await waitFor(() => expect(screen.getByText("Conexão revogada. 2 serviços foram pausados.")).toBeDefined());
  });

  it("cria conexão nova a partir do fornecedor selecionado", async () => {
    vi.mocked(listConnections).mockResolvedValue([]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(createConnection).mockResolvedValue({ ...CONNECTION, id: "conn-nova" });

    renderRoute();

    await screen.findByText("Nova conexão");
    fireEvent.change(screen.getByLabelText("Fornecedor"), { target: { value: "platform-upload" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Conta nova" } });
    fireEvent.change(screen.getByLabelText("Chave"), { target: { value: "chave-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(createConnection).toHaveBeenCalledWith({
        connectorKey: "platform-upload",
        name: "Conta nova",
        auth: { apiKey: "chave-123" }
      })
    );
  });

  it("falha ao revogar mostra mensagem de erro, em vez de falhar em silêncio", async () => {
    vi.mocked(listConnections).mockResolvedValue([CONNECTION]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(revokeConnection).mockRejectedValue(new ApiError(500, "INTERNAL", "Erro interno."));

    renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Revogar" }));

    await screen.findByText("Erro interno.");
  });

  it("falha ao verificar mostra mensagem de erro, em vez de falhar em silêncio", async () => {
    vi.mocked(listConnections).mockResolvedValue([CONNECTION]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(checkConnection).mockRejectedValue(new ApiError(500, "INTERNAL", "Erro interno."));

    renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Verificar" }));

    await screen.findByText("Erro interno.");
  });

  it("erro de rede (não-ApiError) ao criar conexão mostra mensagem genérica", async () => {
    vi.mocked(listConnections).mockResolvedValue([]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(createConnection).mockRejectedValue(new TypeError("Failed to fetch"));

    renderRoute();

    await screen.findByText("Nova conexão");
    fireEvent.change(screen.getByLabelText("Fornecedor"), { target: { value: "platform-upload" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Conta nova" } });
    fireEvent.change(screen.getByLabelText("Chave"), { target: { value: "chave-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await screen.findByText("Não foi possível concluir a ação. Tente novamente.");
  });

  it("erro ao substituir credencial mostra mensagem, em vez de falhar em silêncio", async () => {
    vi.mocked(listConnections).mockResolvedValue([CONNECTION]);
    vi.mocked(getConnectors).mockResolvedValue([CONNECTOR]);
    vi.mocked(replaceConnectionSecret).mockRejectedValue(new ApiError(500, "INTERNAL", "Erro interno."));

    renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Substituir credencial" }));
    fireEvent.change(await screen.findByLabelText("Chave"), { target: { value: "chave-nova" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));

    await screen.findByText("Erro interno.");
  });
});
