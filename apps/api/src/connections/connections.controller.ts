import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { createConnectionRequestSchema, type ConnectionSummary } from "@orquestra/contracts";
import type { Vault } from "@orquestra/core";
import { RequireRole } from "../auth/role.guard";
import { Protected } from "../auth/protected.decorator";
import { getFullAuthContext } from "../auth/auth-context";
import { VAULT } from "./connections.constants";
import { installConnection, listAllConnections } from "./connections.service";
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
}
