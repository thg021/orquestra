import { describe, it, expect } from "vitest";
import { findAgentDefinition } from "../src/catalog";

describe("findAgentDefinition", () => {
  it("acha o agente real por chave e versão", () => {
    const found = findAgentDefinition("accounting-routine", "1.0.0");
    expect(found?.ref).toBe("accounting-routine@1.0.0");
  });

  it("devolve undefined para uma versão que não existe — nunca lança", () => {
    expect(findAgentDefinition("accounting-routine", "9.9.9")).toBeUndefined();
  });

  it("devolve undefined para uma chave que não existe", () => {
    expect(findAgentDefinition("agente-inexistente", "1.0.0")).toBeUndefined();
  });
});
