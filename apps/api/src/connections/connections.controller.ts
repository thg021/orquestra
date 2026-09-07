import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import {
  createConnectionRequestSchema,
  replaceConnectionSecretRequestSchema,
  type ConnectionSummary,
  type RevokeConnectionResponse
} from "@orquestra/contracts";
import type { Vault } from "@orquestra/core";
import { RequireRole } from "../auth/role.guard";
import { Protected } from "../auth/protected.decorator";
import { getFullAuthContext } from "../auth/auth-context";
import { VAULT } from "./connections.constants";
import {
  installConnection,
  listAllConnections,
  replaceConnectionSecret,
  revokeConnection,
  checkConnection
} from "./connections.service";
import { toConnectionSummary } from "./to-summary";

/** `owner`/`admin` escrevem; `operator` só lê — mesma convenção do resto do M1. */
@Controller("connections")
export class ConnectionsController {
  constructor(@Inject(VAULT) private readonly vault: Vault) {}

  @Post()
  @RequireRole("admin")
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @Req() req: Request): Promise<ConnectionSummary> {
    const parsed = createConnectionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    const { tenantId } = getFullAuthContext(req);
    const created = await installConnection(this.vault, tenantId, parsed.data);
    return toConnectionSummary(created);
  }

  @Get()
  @Protected()
  async list(@Req() req: Request): Promise<ConnectionSummary[]> {
    const { tenantId } = getFullAuthContext(req);
    const rows = await listAllConnections(tenantId);
    return rows.map(toConnectionSummary);
  }

  @Patch(":id")
  @RequireRole("admin")
  async replaceSecret(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request
  ): Promise<ConnectionSummary> {
    const parsed = replaceConnectionSecretRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    const { tenantId } = getFullAuthContext(req);
    const updated = await replaceConnectionSecret(this.vault, tenantId, id, parsed.data.auth);
    return toConnectionSummary(updated);
  }

  @Post(":id/revoke")
  @RequireRole("admin")
  @HttpCode(HttpStatus.OK)
  async revoke(@Param("id") id: string, @Req() req: Request): Promise<RevokeConnectionResponse> {
    const { tenantId } = getFullAuthContext(req);
    const { connection, pausedInstanceCount } = await revokeConnection(tenantId, id);
    return { ...toConnectionSummary(connection), pausedInstanceCount };
  }

  @Post(":id/check")
  @RequireRole("admin")
  @HttpCode(HttpStatus.OK)
  async check(@Param("id") id: string, @Req() req: Request): Promise<ConnectionSummary> {
    const { tenantId } = getFullAuthContext(req);
    const checked = await checkConnection(tenantId, id);
    return toConnectionSummary(checked);
  }
}
