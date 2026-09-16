import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRunQueueConnection,
  createRunQueue,
  enqueueRun,
  type RunJob
} from "../../src/execution/queue";
import { createRunWorker, closeRunWorker } from "../../src/execution/worker";
import { startTestRedis, type TestRedis } from "../support/test-redis";

describe("execution/worker", () => {
  let redis: TestRedis;

  beforeAll(async () => {
    redis = await startTestRedis();
  }, 60_000);

  afterAll(async () => {
    await redis.close();
  });

  it("consome o job enfileirado", async () => {
    const producerConnection = createRunQueueConnection(redis.url);
    const queue = createRunQueue(producerConnection);

    const received: RunJob[] = [];
    const consumerConnection = createRunQueueConnection(redis.url);
    const worker = createRunWorker(consumerConnection, async (job) => {
      received.push(job.data);
    });

    const job: RunJob = {
      tenantId: "tenant-1",
      serviceInstanceId: "instance-1",
      runId: "run-1",
      trigger: "manual"
    };

    await new Promise<void>((resolve) => {
      worker.on("completed", () => resolve());
      void enqueueRun(queue, job);
    });

    expect(received).toEqual([job]);

    await closeRunWorker(worker);
    await queue.close();
    consumerConnection.disconnect();
    producerConnection.disconnect();
  }, 30_000);

  it("encerrar o worker espera o job em andamento terminar, sem abrir porta HTTP", async () => {
    const producerConnection = createRunQueueConnection(redis.url);
    const queue = createRunQueue(producerConnection);

    let jobFinished = false;
    const consumerConnection = createRunQueueConnection(redis.url);
    const worker = createRunWorker(consumerConnection, async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      jobFinished = true;
    });

    await enqueueRun(queue, {
      tenantId: "tenant-1",
      serviceInstanceId: "instance-1",
      runId: "run-2",
      trigger: "scheduled"
    });

    // Dá tempo do worker pegar o job antes de mandar fechar — se `close()` não
    // esperasse, `jobFinished` seguiria `false` na linha seguinte.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await closeRunWorker(worker);

    expect(jobFinished).toBe(true);

    await queue.close();
    consumerConnection.disconnect();
    producerConnection.disconnect();
  }, 30_000);
});
