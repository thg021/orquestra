import { z } from "zod";
import { StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { defineAgent } from "../define";

const exerciseStateSchema = z.object({
  step: z.string().default("queued"),
  approvalDecision: z.string().nullable().default(null)
});

/**
 * Três nós — o mínimo que prova checkpoint (um por nó), aprovação (`interrupt` no
 * meio) e entrega (o nó final) sem conhecer nada de contabilidade. Fábrica preguiçosa:
 * chamar isto não toca banco nem checkpointer — quem compila com o checkpointer da
 * transação é o worker (T10), não o catálogo.
 */
function buildExerciseGraph() {
  return new StateGraph(exerciseStateSchema)
    .addNode("prepare", async () => ({ step: "prepared" }))
    .addNode("requestApproval", async () => {
      const decision = interrupt<{ plan: string }, string>({ plan: "entregar 1 item de exercício" });
      return { step: "approved", approvalDecision: decision };
    })
    .addNode("deliver", async () => ({ step: "delivered" }))
    .addEdge(START, "prepare")
    .addEdge("prepare", "requestApproval")
    .addEdge("requestApproval", "deliver")
    .addEdge("deliver", END);
}

/**
 * Não é produto — nunca aparece pra um tenant real decidir instalar fora do
 * desenvolvimento do M2. Existe só para o motor de execução ter algo real pra rodar
 * sem depender da rotina contábil (M4, D41) estar pronta (spec §Fora de escopo).
 */
export const exerciseAgent = defineAgent({
  key: "exercise",
  version: "1.0.0",
  title: "Agente de exercício",
  description: "Só para provar o motor de execução do M2 — checkpoint, aprovação e entrega, sem regra de negócio.",
  configSchema: z.object({}),
  capabilities: [{ capability: "email", required: true }],
  dataCollections: [],
  graph: buildExerciseGraph
});
