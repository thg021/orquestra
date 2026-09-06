import { describe, it, expect } from "vitest";
import { agentSummarySchema, connectorSummarySchema } from "../src/catalog";

describe("agentSummarySchema", () => {
  it("aceita um resumo de agente com capabilities e o schema de configuração embutido", () => {
    const parsed = agentSummarySchema.safeParse({
      key: "accounting-routine",
      version: "1.0.0",
      title: "Rotina contábil",
      description: "...",
      capabilities: [{ capability: "file-storage", required: true }],
      configSchema: { type: "object", properties: {} }
    });

    expect(parsed.success).toBe(true);
  });
});

describe("connectorSummarySchema", () => {
  it("aceita um resumo de conector sem exigir campo de segredo", () => {
    const parsed = connectorSummarySchema.safeParse({
      key: "fortes-conecta",
      title: "Fortes Conecta",
      capability: "document-delivery",
      kind: "native",
      authKind: "api_key",
      authSchema: { type: "object", properties: {} }
    });

    expect(parsed.success).toBe(true);
  });

  it("não tem campo de valor de segredo no schema", () => {
    const keys = Object.keys(connectorSummarySchema.shape);
    expect(keys).not.toContain("secret");
    expect(keys).not.toContain("apiKey");
    expect(keys).not.toContain("value");
  });
});
