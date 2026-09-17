import { describe, it, expect } from "vitest";
import { z } from "zod";
import { StateGraph, START, END } from "@langchain/langgraph";
import { defineAgent, defineConnector } from "../src/define";
import { secret } from "../src/secret";
import { validateCatalog } from "../src/validate";

function noopGraph() {
  return new StateGraph(z.object({})).addNode("noop", async () => ({})).addEdge(START, "noop").addEdge("noop", END);
}

function agent(overrides: Partial<Parameters<typeof defineAgent>[0]> = {}) {
  return defineAgent({
    key: "accounting-routine",
    version: "1.0.0",
    title: "Rotina contábil",
    description: "...",
    configSchema: z.object({ diaDeCorte: z.number().int() }),
    capabilities: [{ capability: "file-storage", required: true }],
    dataCollections: [],
    graph: noopGraph,
    ...overrides
  });
}

function connector(overrides: Partial<Parameters<typeof defineConnector>[0]> = {}) {
  return defineConnector({
    key: "platform-upload",
    title: "Upload direto",
    capability: "file-storage",
    kind: "native",
    authKind: "api_key",
    authSchema: z.object({ apiKey: secret(z.string()) }),
    ...overrides
  });
}

describe("validateCatalog", () => {
  it("aprova um catálogo consistente sem achados", () => {
    const issues = validateCatalog({ agents: [agent()], connectors: [connector()] });
    expect(issues).toEqual([]);
  });

  it("reporta capability órfã, nomeando o agente e a capability", () => {
    const orfa = agent({
      key: "outro-agente",
      capabilities: [{ capability: "messaging", required: true }]
    });

    const issues = validateCatalog({ agents: [agent(), orfa], connectors: [connector()] });

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "CAPABILITY_ORPHANED",
        agentKey: "outro-agente",
        capability: "messaging"
      })
    );
  });

  it("reporta chave de agente duplicada", () => {
    const issues = validateCatalog({ agents: [agent(), agent()], connectors: [connector()] });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_AGENT_KEY", key: "accounting-routine" })
    );
  });

  it("reporta chave de conector duplicada", () => {
    const issues = validateCatalog({ agents: [agent()], connectors: [connector(), connector()] });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_CONNECTOR_KEY", key: "platform-upload" })
    );
  });

  it("reporta versão fora de semver mesmo vinda de fonte que não passou por defineAgent", () => {
    const malformado = { ...agent(), version: "1.0", ref: "accounting-routine@1.0" };

    const issues = validateCatalog({ agents: [malformado], connectors: [connector()] });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_VERSION", key: "accounting-routine", version: "1.0" })
    );
  });

  it("reporta configSchema fora do subconjunto suportado pelo formulário", () => {
    const comMapa = agent({ configSchema: z.map(z.string(), z.string()) });

    const issues = validateCatalog({ agents: [comMapa], connectors: [connector()] });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_FORM_SCHEMA", key: "accounting-routine" })
    );
  });

  it("reporta agente sem grafo mesmo vindo de fonte que não passou por defineAgent", () => {
    const semGrafo = { ...agent(), graph: undefined as unknown as () => never };

    const issues = validateCatalog({ agents: [semGrafo], connectors: [connector()] });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "AGENT_MISSING_GRAPH", key: "accounting-routine" })
    );
  });

  it("reporta authSchema de conector fora do subconjunto suportado", () => {
    const comMapa = connector({
      authSchema: z.object({ apiKey: secret(z.string()), extra: z.map(z.string(), z.string()) })
    });

    const issues = validateCatalog({ agents: [agent()], connectors: [comMapa] });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_FORM_SCHEMA", key: "platform-upload" })
    );
  });
});
