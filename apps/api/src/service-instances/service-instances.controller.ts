import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import type { ServiceInstanceRow } from "@orquestra/db";
import {
  createServiceInstanceRequestSchema,
  updateServiceInstanceRequestSchema,
  type ServiceInstanceSummary
} from "@orquestra/contracts";
import { Protected } from "../auth/protected.decorator";
import { RequireRole } from "../auth/role.guard";
import { getFullAuthContext } from "../auth/auth-context";
import {
  installServiceInstance,
  listAllServiceInstances,
  getServiceInstance,
  updateServiceInstanceById,
  removeServiceInstanceById
} from "./service-instances.service";

function toSummary(row: ServiceInstanceRow): ServiceInstanceSummary {
  return {
    id: row.id,
    agentKey: row.agentKey,
    agentVersion: row.agentVersion,
    name: row.name,
    config: row.config,
    status: row.status,
    statusReason: row.statusReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/**
 * `owner`/`admin` escrevem; `operator` só lê (RequireRole vs Protected) — regra da
 * spec do M1, mesma convenção do M0 para RoleGuard.
 */
@Controller("service-instances")
export class ServiceInstancesController {
  @Post()
  @RequireRole("admin")
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @Req() req: Request): Promise<ServiceInstanceSummary> {
    const parsed = createServiceInstanceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    const { tenantId } = getFullAuthContext(req);
    const created = await installServiceInstance(tenantId, parsed.data);
    return toSummary(created);
  }

  @Get()
  @Protected()
  async list(@Req() req: Request): Promise<ServiceInstanceSummary[]> {
    const { tenantId } = getFullAuthContext(req);
    const rows = await listAllServiceInstances(tenantId);
    return rows.map(toSummary);
  }

  @Get(":id")
  @Protected()
  async findOne(@Param("id") id: string, @Req() req: Request): Promise<ServiceInstanceSummary> {
    const { tenantId } = getFullAuthContext(req);
    const row = await getServiceInstance(tenantId, id);
    return toSummary(row);
  }

  @Patch(":id")
  @RequireRole("admin")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request
  ): Promise<ServiceInstanceSummary> {
    const parsed = updateServiceInstanceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    const { tenantId } = getFullAuthContext(req);
    const updated = await updateServiceInstanceById(tenantId, id, parsed.data);
    return toSummary(updated);
  }

  @Delete(":id")
  @RequireRole("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: Request): Promise<void> {
    const { tenantId } = getFullAuthContext(req);
    await removeServiceInstanceById(tenantId, id);
  }
}
