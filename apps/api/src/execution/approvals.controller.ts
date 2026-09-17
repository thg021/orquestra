import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { ApprovalRequestSummary } from "@orquestra/contracts";
import { Protected } from "../auth/protected.decorator";
import { RequireRole } from "../auth/role.guard";
import { getFullAuthContext } from "../auth/auth-context";
import { listPendingApprovals, approveRequest, rejectRequest } from "./approval.service";
import { toApprovalRequestSummary } from "./to-approval-summary";
import { RUN_QUEUE } from "./execution.constants";
import type { RunQueueClient } from "./queue";

/**
 * `owner`/`admin` decidem; `operator` só lê — mesma regra do resto da API (design
 * §Superfície de API: "Aprovar é escrita — operator recebe 403").
 */
@Controller("approvals")
export class ApprovalsController {
  constructor(@Inject(RUN_QUEUE) private readonly runQueue: RunQueueClient) {}

  @Get()
  @Protected()
  async list(@Req() req: Request): Promise<ApprovalRequestSummary[]> {
    const { tenantId } = getFullAuthContext(req);
    const approvals = await listPendingApprovals(tenantId);
    return approvals.map(toApprovalRequestSummary);
  }

  @Post(":id/approve")
  @RequireRole("admin")
  @HttpCode(HttpStatus.OK)
  async approve(@Param("id") id: string, @Req() req: Request): Promise<ApprovalRequestSummary> {
    const { tenantId, userId } = getFullAuthContext(req);
    const approval = await approveRequest(tenantId, id, userId, this.runQueue);
    return toApprovalRequestSummary(approval);
  }

  @Post(":id/reject")
  @RequireRole("admin")
  @HttpCode(HttpStatus.OK)
  async reject(@Param("id") id: string, @Req() req: Request): Promise<ApprovalRequestSummary> {
    const { tenantId, userId } = getFullAuthContext(req);
    const approval = await rejectRequest(tenantId, id, userId);
    return toApprovalRequestSummary(approval);
  }
}
