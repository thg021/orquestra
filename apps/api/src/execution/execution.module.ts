import { DynamicModule, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { createRunQueueClient, type RunQueueClient } from "./queue";
import { RunsController } from "./runs.controller";
import { ApprovalsController } from "./approvals.controller";
import { RUN_QUEUE } from "./execution.constants";

/** Fecha o client (se ele chegou a conectar) quando o app cai — cada teste e2e sobe e derruba o próprio app. */
@Injectable()
class RunQueueLifecycle implements OnModuleDestroy {
  constructor(@Inject(RUN_QUEUE) private readonly runQueue: RunQueueClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.runQueue.close();
  }
}

@Module({})
export class ExecutionModule {
  static register(redisUrl: string): DynamicModule {
    return {
      module: ExecutionModule,
      controllers: [RunsController, ApprovalsController],
      providers: [{ provide: RUN_QUEUE, useFactory: () => createRunQueueClient(redisUrl) }, RunQueueLifecycle],
      exports: [RUN_QUEUE]
    };
  }
}
