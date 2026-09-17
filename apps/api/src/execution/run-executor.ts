import { withTenant, findServiceRunById, transitionServiceRunStatus } from "@orquestra/db";
import { runAgentGraph } from "./graph-runner";
import { requestApproval } from "./approval.service";
import type { RunJob } from "./queue";

const FINAL_STATUSES = new Set(["succeeded", "failed"]);
// T12 (APR-01/APR-02): `awaiting_approval` não é status final (`transitionServiceRunStatus`
// deixa sair dele à vontade — só `succeeded`/`failed` bloqueiam saída), mas o worker
// precisa, por conta própria, tratá-lo como "não mexo, só decisão humana mexe". Reentrega
// da fila pra um run pausado nunca deve rodar o grafo de novo.
const SKIP_STATUSES = new Set([...FINAL_STATUSES, "awaiting_approval"]);

/** Nunca `error.message` cru — pode carregar segredo ou string de conexão do que falhou. */
function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export interface ExecuteRunJobOptions {
  /** Injetável em teste — o default (T10) é a execução de verdade do grafo do agente. */
  runAgentGraphFn?: typeof runAgentGraph;
  /** Injetável em teste — o default (T12) cria o `ApprovalRequest` de verdade. */
  requestApprovalFn?: typeof requestApproval;
}

/**
 * O que o worker chama para cada job (T5). `withTenant` é a primeira coisa que
 * acontece — nenhuma leitura de negócio existe antes dele (RUN-02). RLS garante que
 * um run de outro tenant nem aparece aqui, não uma checagem de aplicação.
 */
export async function executeRunJob(job: RunJob, options: ExecuteRunJobOptions = {}): Promise<void> {
  const runAgentGraphFn = options.runAgentGraphFn ?? runAgentGraph;
  const requestApprovalFn = options.requestApprovalFn ?? requestApproval;

  await withTenant(job.tenantId, async (tx) => {
    const run = await findServiceRunById(job.runId, tx);
    // RUN-04: run inexistente sob este tenant, já num estado final, ou esperando
    // decisão humana (T12) — reentrega (fila, ou job de outro tenant que não enxerga
    // a linha) não executa nada.
    if (!run || SKIP_STATUSES.has(run.status)) {
      return;
    }

    // RUN-06: se já está `running`, é uma redelivery depois do worker cair no meio —
    // retoma sem reiniciar `startedAt`. Só transiciona de `queued` na primeira vez.
    if (run.status === "queued") {
      await transitionServiceRunStatus(job.runId, "running", tx);
    }

    try {
      const outcome = await runAgentGraphFn(job.tenantId, run, tx);
      // T12 (APR-01/APR-02): o grafo pausou pedindo aprovação — o run vai pra
      // `awaiting_approval`, nunca `succeeded`. Retomar é decisão humana (T13/T14).
      if (outcome.status === "interrupted") {
        await requestApprovalFn(job.tenantId, run, outcome.payload, tx);
      } else {
        await transitionServiceRunStatus(job.runId, "succeeded", tx);
      }
    } catch (error) {
      await transitionServiceRunStatus(job.runId, "failed", tx, { error: sanitizeError(error) });
    }
  });
}
