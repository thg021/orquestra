import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const RUN_QUEUE_NAME = "service-runs";

export type RunTrigger = "manual" | "scheduled";

/** Ponteiro, não conteúdo — dado de negócio e segredo ficam no banco, atrás do RLS. */
export interface RunJob {
  tenantId: string;
  serviceInstanceId: string;
  runId: string;
  trigger: RunTrigger;
}

/**
 * Monta o payload campo a campo em vez de espalhar (`...input`). Assim um campo
 * extra em `input` — vindo de um tipo mais largo em algum chamador — nunca
 * sobrevive à serialização do job.
 */
function toRunJobData(input: RunJob): RunJob {
  return {
    tenantId: input.tenantId,
    serviceInstanceId: input.serviceInstanceId,
    runId: input.runId,
    trigger: input.trigger
  };
}

/**
 * `maxRetriesPerRequest: null` é o que o BullMQ exige da conexão: sem isso, um
 * comando falho por queda de rede rejeita a promise em vez de deixar o cliente
 * reconectar sozinho. O listener de erro é o que impede um ECONNREFUSED de virar
 * exceção não tratada e derrubar o processo `api`.
 */
export function createRunQueueConnection(redisUrl: string): Redis {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  connection.on("error", (error) => {
    // Nunca `error.message` cru: driver de conexão pode ecoar host/porta e, em
    // alguns clientes, a própria URL de conexão.
    console.error(`[execution/queue] erro de conexão com Redis (${error.name})`);
  });
  return connection;
}

export function createRunQueue(connection: Redis): Queue<RunJob> {
  return new Queue<RunJob>(RUN_QUEUE_NAME, { connection });
}

export async function enqueueRun(queue: Queue<RunJob>, job: RunJob): Promise<void> {
  await queue.add(RUN_QUEUE_NAME, toRunJobData(job));
}
