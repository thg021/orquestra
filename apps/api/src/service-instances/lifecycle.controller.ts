import { Controller, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { ServiceInstanceSummary } from "@orquestra/contracts";
import { RequireRole } from "../auth/role.guard";
import { getFullAuthContext } from "../auth/auth-context";
import { activateServiceInstance, pauseServiceInstance } from "./lifecycle.service";
import { toServiceInstanceSummary } from "./to-summary";

/** `owner`/`admin` escrevem — mesma regra do resto de service-instances. */
@Controller("service-instances/:id")
export class LifecycleController {
  @Post("activate")
  @RequireRole("admin")
  @HttpCode(HttpStatus.OK)
  async activate(@Param("id") id: string, @Req() req: Request): Promise<ServiceInstanceSummary> {
    const { tenantId } = getFullAuthContext(req);
    const updated = await activateServiceInstance(tenantId, id);
    return toServiceInstanceSummary(updated);
  }

  @Post("pause")
  @RequireRole("admin")
  @HttpCode(HttpStatus.OK)
  async pause(@Param("id") id: string, @Req() req: Request): Promise<ServiceInstanceSummary> {
    const { tenantId } = getFullAuthContext(req);
    const updated = await pauseServiceInstance(tenantId, id);
    return toServiceInstanceSummary(updated);
  }
}
