import { newId } from "@orquestra/core";
import { createApprovalRequest, transitionServiceRunStatus, type ServiceRunRow, type Tx } from "@orquestra/db";

/**
 * APR-01/APR-02: o grafo pausou em `interrupt()` — nasce o pedido de decisão com o
 * payload que o próprio nó do agente passou pro `interrupt(...)` (nunca o estado
 * inteiro do grafo, só o que o agente decidiu expor — D40: o plano de entrega nunca
 * carrega segredo), e o run sai de `running` para `awaiting_approval`.
 *
 * Fronteira com `graph-runner.ts`: aquele arquivo sabe de LangGraph, `interrupt()` e
 * checkpoint; este só sabe de `ApprovalRequest` e status do `ServiceRun`. Quem decide
 * "o grafo pausou, e é isso que ele pediu" é o `graph-runner`; quem decide "então nasce
 * um pedido e o run espera" é este serviço.
 */
export async function requestApproval(
  tenantId: string,
  run: ServiceRunRow,
  payload: unknown,
  tx: Tx
): Promise<string> {
  const id = newId();
  await createApprovalRequest({ id, tenantId, runId: run.id, payload }, tx);
  await transitionServiceRunStatus(run.id, "awaiting_approval", tx);
  return id;
}
