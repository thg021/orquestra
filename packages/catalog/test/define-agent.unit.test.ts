import { describe, it, expect } from "vitest";
import { z } from "zod";
import { StateGraph, START, END } from "@langchain/langgraph";
import { defineAgent } from "../src/define";

function noopGraph() {
  return new StateGraph(z.object({})).addNode("noop", async () => ({})).addEdge(START, "noop").addEdge("noop", END);
}

const validInput = {
  key: "accounting-routine",
  version: "1.0.0",
  title: "Rotina contábil",
  description: "Confere folha e fiscal, e entrega os documentos aos clientes.",
  configSchema: z.object({ diaDeCorte: z.number().int() }),
  capabilities: [
    { capability: "file-storage", required: true },
    { capability: "messaging", required: false }
  ],
  dataCollections: [{ key: "customers", schema: z.object({ nome: z.string() }) }],
  graph: noopGraph
} as const;

describe("defineAgent", () => {
  it("devolve a definição com referência key@version", () => {
    const agent = defineAgent(validInput);

    expect(agent.key).toBe("accounting-routine");
    expect(agent.version).toBe("1.0.0");
    expect(agent.ref).toBe("accounting-routine@1.0.0");
  });

  it("preserva quais capabilities são obrigatórias e quais são opcionais", () => {
    const agent = defineAgent(validInput);

    expect(agent.requiredCapabilities).toEqual(["file-storage"]);
    expect(agent.optionalCapabilities).toEqual(["messaging"]);
  });

  it("recusa versão fora do formato semver, nomeando o valor recebido", () => {
    expect(() => defineAgent({ ...validInput, version: "1.0" })).toThrowError(/1\.0/);
  });

  it("recusa chave fora do formato slug", () => {
    expect(() => defineAgent({ ...validInput, key: "Accounting Routine" })).toThrowError(
      /Accounting Routine/
    );
  });

  it("recusa agente que não declara nenhuma capability", () => {
    expect(() => defineAgent({ ...validInput, capabilities: [] })).toThrowError(/capability/i);
  });

  it("recusa a mesma capability declarada duas vezes", () => {
    expect(() =>
      defineAgent({
        ...validInput,
        capabilities: [
          { capability: "email", required: true },
          { capability: "email", required: false }
        ]
      })
    ).toThrowError(/email/);
  });

  it("recusa duas coleções de dados com a mesma chave", () => {
    expect(() =>
      defineAgent({
        ...validInput,
        dataCollections: [
          { key: "customers", schema: z.object({ nome: z.string() }) },
          { key: "customers", schema: z.object({ outro: z.string() }) }
        ]
      })
    ).toThrowError(/customers/);
  });

  it("recusa agente que não declara grafo", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- só o resto do objeto importa aqui
    const { graph: _graph, ...withoutGraph } = validInput;
    expect(() => defineAgent(withoutGraph as unknown as typeof validInput)).toThrowError(/grafo/i);
  });

  it("erro de definição carrega código estável para o chamador tratar", () => {
    try {
      defineAgent({ ...validInput, version: "1.0" });
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("CATALOG_DEFINITION_INVALID");
    }
  });
});
