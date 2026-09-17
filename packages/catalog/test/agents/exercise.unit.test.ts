import { describe, it, expect } from "vitest";
import { MemorySaver, Command } from "@langchain/langgraph";
import { exerciseAgent } from "../../src/agents/exercise";

describe("exerciseAgent", () => {
  it("não é a rotina contábil — existe só para o M2 testar contra", () => {
    expect(exerciseAgent.key).toBe("exercise");
    expect(exerciseAgent.ref).toBe("exercise@1.0.0");
  });

  it("exige email como capability obrigatória", () => {
    expect(exerciseAgent.requiredCapabilities).toEqual(["email"]);
  });

  it("listar a definição não constrói grafo nenhum — graph é uma função, não o grafo em si", () => {
    expect(typeof exerciseAgent.graph).toBe("function");
  });

  it("o grafo tem passos suficientes pra provar checkpoint, aprovação e entrega", async () => {
    const checkpointer = new MemorySaver();
    const compiled = exerciseAgent.graph().compile({ checkpointer });
    const config = { configurable: { thread_id: "run-exercise-1" } };

    const beforeApproval = await compiled.invoke({}, config);
    // Parou no interrupt — "deliver" ainda não rodou.
    expect(beforeApproval.step).toBe("prepared");
    expect(beforeApproval.__interrupt__).toBeDefined();

    const afterApproval = await compiled.invoke(new Command({ resume: "aprovado" }), config);
    expect(afterApproval.step).toBe("delivered");
    expect(afterApproval.approvalDecision).toBe("aprovado");
  });
});
