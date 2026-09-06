import { BadRequestException, Body, Controller, Delete, HttpCode, HttpStatus, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { bindCapabilityRequestSchema } from "@orquestra/contracts";
import { RequireRole } from "../auth/role.guard";
import { getFullAuthContext } from "../auth/auth-context";
import { bindCapability, unbindCapability } from "./bindings.service";

/** `owner`/`admin` escrevem — mesma regra do resto de service-instances. */
@Controller("service-instances/:id/bindings")
export class BindingsController {
  @Put(":capability")
  @RequireRole("admin")
  async bind(
    @Param("id") serviceInstanceId: string,
    @Param("capability") capability: string,
    @Body() body: unknown,
    @Req() req: Request
  ): Promise<{ capability: string; connectionId: string }> {
    const parsed = bindCapabilityRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    const { tenantId } = getFullAuthContext(req);
    await bindCapability(tenantId, serviceInstanceId, capability, parsed.data.connectionId);
    return { capability, connectionId: parsed.data.connectionId };
  }

  @Delete(":capability")
  @RequireRole("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  async unbind(
    @Param("id") serviceInstanceId: string,
    @Param("capability") capability: string,
    @Req() req: Request
  ): Promise<void> {
    const { tenantId } = getFullAuthContext(req);
    await unbindCapability(tenantId, serviceInstanceId, capability);
  }
}
