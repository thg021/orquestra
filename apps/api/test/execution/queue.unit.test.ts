import { describe, it, expect, vi, afterEach } from "vitest";
import type { Queue } from "bullmq";
import {
  createRunQueueConnection,
  createRunQueueClient,
  enqueueRun,
  RUN_QUEUE_NAME,
  type RunJob
} from "../../src/execution/queue";

describe("execution/queue", () => {
  const connections: ReturnType<typeof createRunQueueConnection>[] = [];

  afterEach(() => {
    for (const connection of connections.splice(0)) {
      connection.disconnect();
    }
  });

  it("enfileira só tenantId, serviceInstanceId, runId e trigger, mesmo com campo extra no objeto de entrada", async () => {
    const job = {
      tenantId: "tenant-1",
      serviceInstanceId: "instance-1",
      runId: "run-1",
      trigger: "manual",
      // campo que não deveria existir no tipo, mas pode chegar de um cast solto
      secret: "não pode vazar pra fila"
    } as RunJob & { secret: string };

    const add = vi.fn().mockResolvedValue(undefined);
    const fakeQueue = { add } as unknown as Queue<RunJob>;

    await enqueueRun(fakeQueue, job);

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data] = add.mock.calls[0] as [string, RunJob];
    expect(name).toBe(RUN_QUEUE_NAME);
    expect(Object.keys(data).sort()).toEqual(
      ["runId", "serviceInstanceId", "tenantId", "trigger"].sort()
    );
    expect(JSON.parse(JSON.stringify(data))).not.toHaveProperty("secret");
  });

  it("a conexão nasce com um listener de erro — perder o Redis não vira exceção não tratada", () => {
    const connection = createRunQueueConnection("redis://127.0.0.1:1");
    connections.push(connection);

    expect(connection.listenerCount("error")).toBeGreaterThan(0);
  });

  it("createRunQueueClient não conecta nada até o primeiro enqueue", async () => {
    // Endereço inválido de propósito: se o client tentasse conectar aqui, close()
    // demoraria (tentativa de handshake) ou emitiria erro. Nenhum enqueue foi chamado.
    const client = createRunQueueClient("redis://127.0.0.1:1");

    const start = Date.now();
    await client.close();

    expect(Date.now() - start).toBeLessThan(50);
  });
});
