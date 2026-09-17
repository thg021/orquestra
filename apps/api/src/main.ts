import "reflect-metadata";
import { bootstrap } from "./bootstrap";
import { createRunQueueConnection } from "./execution/queue";
import { createRunWorker, closeRunWorker } from "./execution/worker";
import { executeRunJob } from "./execution/run-executor";

/**
 * A execução de verdade do grafo do agente chega na T10 (via `runAgentGraphFn`
 * injetável de `executeRunJob`) — até lá, todo run bem formado termina `succeeded`
 * sem fazer nada além do ciclo de vida (contexto de tenant, status, erro sanitizado).
 */
async function startWorker(redisUrl: string): Promise<void> {
  const connection = createRunQueueConnection(redisUrl);
  const worker = createRunWorker(connection, async (job) => {
    await executeRunJob(job.data);
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`orquestra: worker recebeu ${signal}, esperando o job em andamento terminar`);
    await closeRunWorker(worker);
    connection.disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  console.log("orquestra: worker consumindo a fila de execução");
}

bootstrap(process.env)
  .then(async (result) => {
    if (result.app) {
      await result.app.listen(result.config.API_PORT);
      console.log(`orquestra: api ouvindo na porta ${result.config.API_PORT}`);
    } else if (result.config.PROCESS_ROLE === "worker") {
      await startWorker(result.config.REDIS_URL);
    } else {
      console.log(`orquestra: papel "${result.config.PROCESS_ROLE}" ainda não implementado (chega no M2)`);
    }
  })
  .catch((error: unknown) => {
    console.error("orquestra: falha na inicialização", error);
    process.exit(1);
  });
