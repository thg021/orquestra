import { withTenant, findServiceRunById, transitionServiceRunStatus } from "@orquestra/db";
import { runAgentGraph } from "./graph-runner";
import type { RunJob } from "./queue";

const FINAL_STATUSES = new Set(["succeeded", "failed"]);

/** Nunca `error.message` cru — pode carregar segredo ou string de conexão do que falhou. */
function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export interface ExecuteRunJobOptions {
  /** Injetável em teste — o default (T10) é a execução de verdade do grafo do agente. */
  runAgentGraphFn?: typeof runAgentGraph;
}

/**
 * O que o worker chama para cada job (T5). `withTenant` é a primeira coisa que
 * acontece — nenhuma leitura de negócio existe antes dele (RUN-02). RLS garante que
 * um run de outro tenant nem aparece aqui, não uma checagem de aplicação.
 */
export async function executeRunJob(job: RunJob, options: ExecuteRunJobOptions = {}): Promise<void> {
  const runAgentGraphFn = options.runAgentGraphFn ?? runAgentGraph;

  await withTenant(job.tenantId, async (tx) => {
    const run = await findServiceRunById(job.runId, tx);
    // RUN-04: run inexistente sob este tenant ou já num estado final — reentrega
    // (fila, ou job de outro tenant que não enxerga a linha) não executa nada.
    if (!run || FINAL_STATUSES.has(run.status)) {
      return;
    }

    // RUN-06: se já está `running`, é uma redelivery depois do worker cair no meio —
    // retoma sem reiniciar `startedAt`. Só transiciona de `queued` na primeira vez.
    if (run.status === "queued") {
      await transitionServiceRunStatus(job.runId, "running", tx);
    }

    try {
      await runAgentGraphFn(job.tenantId, run, tx);
      await transitionServiceRunStatus(job.runId, "succeeded", tx);
    } catch (error) {
      await transitionServiceRunStatus(job.runId, "failed", tx, { error: sanitizeError(error) });
    }
  });
}
