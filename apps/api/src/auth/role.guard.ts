import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { hasAtLeast, type Role } from "@orquestra/core";
import { findActiveMembership } from "../identity/identity.repository";
import { getAuthContext, setAuthContext } from "./auth-context";
import { SessionGuard } from "./session.guard";
import { TenantScopeInterceptor, NO_MEMBERSHIP_ERROR_CODE } from "./tenant-scope.interceptor";

export const REQUIRED_ROLE_KEY = "orquestra:requiredRole";
export const INSUFFICIENT_ROLE_ERROR_CODE = "INSUFFICIENT_ROLE";

/**
 * Guard, não interceptor: guards rodam antes de qualquer interceptor no pipeline do
 * Nest, então não pode depender do contexto que o TenantScopeInterceptor completaria
 * depois. Por isso resolve o tenant/papel ele mesmo — TenantScopeInterceptor, quando
 * também aplicado (via @RequireRole), encontra o contexto já completo e só repassa.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<Role | undefined>(REQUIRED_ROLE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const sessionContext = getAuthContext(request);
    if (!sessionContext) {
      throw new UnauthorizedException();
    }

    const membership = await findActiveMembership(sessionContext.userId);
    if (!membership) {
      throw new ForbiddenException({ code: NO_MEMBERSHIP_ERROR_CODE });
    }

    setAuthContext(request, {
      ...sessionContext,
      tenantId: membership.tenantId,
      tenantName: membership.tenantName,
      role: membership.role
    });

    if (requiredRole && !hasAtLeast(membership.role, requiredRole)) {
      throw new ForbiddenException({ code: INSUFFICIENT_ROLE_ERROR_CODE });
    }

    return true;
  }
}

/**
 * Rota protegida com piso de papel: autentica, resolve tenant/papel e recusa com 403
 * (INSUFFICIENT_ROLE, distinto do 401 de autenticação) se o papel for insuficiente.
 * Autossuficiente — não precisa de @Protected() junto.
 */
export function RequireRole(role: Role): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_ROLE_KEY, role),
    UseGuards(SessionGuard, RoleGuard),
    UseInterceptors(TenantScopeInterceptor)
  );
}
