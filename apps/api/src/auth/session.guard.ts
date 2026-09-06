import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { resolveSession } from "./session.repository";
import { setAuthContext } from "./auth-context";

export const SESSION_COOKIE_NAME = "orquestra_session";

/**
 * Autenticação apenas: cookie ausente, adulterado (não encontra linha), inexistente ou
 * expirado são todos tratados de forma idêntica — 401 uniforme (AUTH-04, AUTH-06).
 * Resolução de tenant/membership é responsabilidade do TenantScopeInterceptor, que
 * roda depois — a separação existe para o guard não decidir autorização, só identidade.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];

    const session = rawToken ? await resolveSession(rawToken) : undefined;
    if (!session) {
      throw new UnauthorizedException();
    }

    setAuthContext(request, { sessionId: session.sessionId, userId: session.userId });
    return true;
  }
}
