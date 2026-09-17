import { Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { ServiceRunSummary } from "@orquestra/contracts";
import { RequireRole } from "../auth/role.guard";
import { getFullAuthContext } from "../auth/auth-context";
import { triggerManualRun } from "./runs.service";
import { toServiceRunSummary } from "./to-run-summary";
import { RUN_QUEUE } from "./execution.constants";
import type { RunQueueClient } from "./queue";

/** `owner`/`admin` disparam; `operator` só lê — mesma regra do resto de service-instances. */
@Controller("service-instances/:id")
export class RunsController {
  constructor(@Inject(RUN_QUEUE) private readonly runQueue: RunQueueClient) {}

  @Post("runs")
  @RequireRole("admin")
  @HttpCode(HttpStatus.CREATED)
  async trigger(@Param("id") id: string, @Req() req: Request): Promise<ServiceRunSummary> {
    const { tenantId } = getFullAuthContext(req);
    const run = await triggerManualRun(tenantId, id, this.runQueue);
    return toServiceRunSummary(run);
  }
}
