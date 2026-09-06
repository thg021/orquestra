import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  UnauthorizedException
} from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { findActiveMembership } from "../identity/identity.repository";
import { getAuthContext, setAuthContext } from "./auth-context";

/** Código estável no corpo do 403 — distinto do 401, para o cliente diferenciar os dois. */
export const NO_MEMBERSHIP_ERROR_CODE = "NO_MEMBERSHIP";

/**
 * Roda depois do SessionGuard (interceptors executam após guards no pipeline do Nest).
 * Resolve o tenant ativo do usuário autenticado e completa o contexto da requisição —
 * é aqui que AUTH-07 se aplica: usuário sem vínculo nenhum é recusado com 403, distinto
 * do 401 de autenticação.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const sessionContext = getAuthContext(request);

    if (!sessionContext) {
      // Defensivo: só acontece se a rota usa o interceptor sem o guard.
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

    return next.handle();
  }
}
