import { Worker, type Processor } from "bullmq";
import type { Redis } from "ioredis";
import { RUN_QUEUE_NAME, type RunJob } from "./queue";

/**
 * A lógica de processamento (T7 em diante) entra como `processJob` — este módulo só
 * liga o consumidor à fila. Fica testável sem run, checkpoint ou gate nenhum.
 */
export function createRunWorker(connection: Redis, processJob: Processor<RunJob>): Worker<RunJob> {
  const worker = new Worker<RunJob>(RUN_QUEUE_NAME, processJob, { connection });
  worker.on("error", (error) => {
    console.error(`[execution/worker] erro de conexão com Redis (${error.name})`);
  });
  return worker;
}

/**
 * `worker.close()` sem `force` espera o job em andamento terminar antes de resolver —
 * é a garantia nativa do BullMQ que RUN-06 (worker morre no meio) depende de não
 * precisar reinventar aqui.
 */
export async function closeRunWorker(worker: Worker<RunJob>): Promise<void> {
  await worker.close();
}
