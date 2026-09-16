import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";

export interface TestRedis {
  container: StartedRedisContainer;
  url: string;
  close(): Promise<void>;
}

/** Container descartável por suíte — mesma filosofia de `test-database.ts` para o Postgres. */
export async function startTestRedis(): Promise<TestRedis> {
  const container = await new RedisContainer("redis:7-alpine").start();

  return {
    container,
    url: container.getConnectionUrl(),
    async close() {
      await container.stop();
    }
  };
}
