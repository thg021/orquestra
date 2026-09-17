import { newId } from "@orquestra/core";
import {
  createApprovalRequest,
  findApprovalRequestById,
  findServiceRunById,
  listPendingApprovalRequests,
  decideApprovalRequest,
  transitionServiceRunStatus,
  withTenant,
  AlreadyDecidedError,
  type ApprovalRequestRow,
  type ServiceRunRow,
  type Tx
} from "@orquestra/db";
import { ApprovalAlreadyDecidedError, ApprovalRequestNotFoundError, ServiceRunNotFoundError } from "./errors";
import type { RunQueueClient, RunTrigger } from "./queue";

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

/** Fila de pendentes do tenant, mais recente primeiro (T13, "What": listar pendentes). */
export async function listPendingApprovals(tenantId: string): Promise<ApprovalRequestRow[]> {
  return withTenant(tenantId, (tx) => listPendingApprovalRequests(tenantId, tx));
}

async function getApprovalOrThrow(id: string, tx: Tx): Promise<ApprovalRequestRow> {
  const found = await findApprovalRequestById(id, tx);
  // Aprovação de outro tenant não é lida aqui — RLS já a torna invisível antes de
  // chegar neste `SELECT` — então "não achei" e "é de outro tenant" chegam ao mesmo 404.
  if (!found) {
    throw new ApprovalRequestNotFoundError(id);
  }
  return found;
}

/**
 * A guarda contra decidir duas vezes é do banco (`decideApprovalRequest`, `UPDATE ...
 * WHERE status = 'pending'`). Aqui só se traduz `AlreadyDecidedError` (puro, de
 * `@orquestra/db`) para o `DomainError` que o `ErrorFilter` sabe mapear — 409, sem
 * tocar no `ServiceRun` quando a decisão não aconteceu de fato.
 */
async function decide(
  id: string,
  status: "approved" | "rejected",
  decidedBy: string,
  tx: Tx
): Promise<ApprovalRequestRow> {
  await getApprovalOrThrow(id, tx);
  try {
    await decideApprovalRequest(id, status, decidedBy, tx);
  } catch (error) {
    if (error instanceof AlreadyDecidedError) {
      throw new ApprovalAlreadyDecidedError(id);
    }
    throw error;
  }
  const decided = await findApprovalRequestById(id, tx);
  if (!decided) {
    throw new ApprovalRequestNotFoundError(id);
  }
  return decided;
}

/**
 * APR-03: registra quem aprovou e quando, e reenfileira o run — usando o mesmo
 * `RunQueueClient` do disparo manual (T6). Só o ponteiro do run volta pra fila; o
 * job carrega o `trigger` original do run, porque não é um novo tipo de disparo, é a
 * mesma execução continuando. Retomar de verdade (reavaliar o gate, `Command({resume})`)
 * é do worker — T14, fora de escopo aqui.
 */
export async function approveRequest(
  tenantId: string,
  id: string,
  decidedBy: string,
  runQueue: RunQueueClient
): Promise<ApprovalRequestRow> {
  const decided = await withTenant(tenantId, (tx) => decide(id, "approved", decidedBy, tx));

  const run = await withTenant(tenantId, (tx) => findServiceRunById(decided.runId, tx));
  if (!run) {
    throw new ServiceRunNotFoundError(decided.runId);
  }
  await runQueue.enqueue({
    tenantId,
    serviceInstanceId: run.serviceInstanceId,
    runId: run.id,
    trigger: run.trigger as RunTrigger
  });

  return decided;
}

/**
 * APR-04: recusar encerra o run sem executar o pendente. A transição pra `failed`
 * roda na MESMA `tx` da decisão — se a decisão falhar (409, já decidido), o run nunca
 * é tocado; ordem importa (ver `decide`, que lança antes de qualquer efeito no run).
 */
export async function rejectRequest(tenantId: string, id: string, decidedBy: string): Promise<ApprovalRequestRow> {
  return withTenant(tenantId, async (tx) => {
    const decided = await decide(id, "rejected", decidedBy, tx);
    await transitionServiceRunStatus(decided.runId, "failed", tx, {
      error: "Execução recusada na aprovação."
    });
    return decided;
  });
}
