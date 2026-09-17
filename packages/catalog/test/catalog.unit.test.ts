import { describe, it, expect } from "vitest";
import { AGENTS, CONNECTORS, validateBuiltinCatalog } from "../src/catalog";

describe("catálogo real do M1", () => {
  it("carrega o agente contábil, o de exercício, e os seis conectores", () => {
    expect(AGENTS.map((a) => a.key)).toEqual(["accounting-routine", "exercise"]);
    expect(CONNECTORS.map((c) => c.key).sort()).toEqual(
      ["fortes-conecta", "gmail", "google-drive", "onedrive", "platform-upload", "whatsapp"].sort()
    );
  });

  it("valida sem achados: toda capability exigida pelo agente tem conector", () => {
    expect(validateBuiltinCatalog()).toEqual([]);
  });
});
