import type { Request } from "express";
import type { Role } from "@orquestra/core";

/** Populado pelo SessionGuard: identidade autenticada, ainda sem tenant resolvido. */
export interface SessionAuthContext {
  sessionId: string;
  userId: string;
}

/** Completado pelo TenantScopeInterceptor com o tenant ativo do usuário. */
export interface FullAuthContext extends SessionAuthContext {
  tenantId: string;
  tenantName: string;
  role: Role;
}

const AUTH_CONTEXT_KEY = Symbol("orquestra:authContext");

type RequestWithAuthContext = Request & { [AUTH_CONTEXT_KEY]?: SessionAuthContext | FullAuthContext };

export function setAuthContext(
  request: Request,
  context: SessionAuthContext | FullAuthContext
): void {
  (request as RequestWithAuthContext)[AUTH_CONTEXT_KEY] = context;
}

export function getAuthContext(request: Request): SessionAuthContext | FullAuthContext | undefined {
  return (request as RequestWithAuthContext)[AUTH_CONTEXT_KEY];
}

/** Usado pelos controllers: exige que o tenant já tenha sido resolvido pelo interceptor. */
export function getFullAuthContext(request: Request): FullAuthContext {
  const context = getAuthContext(request);
  if (!context || !("tenantId" in context)) {
    throw new Error(
      "FullAuthContext ausente — a rota precisa de @Protected() (SessionGuard + TenantScopeInterceptor)."
    );
  }
  return context;
}
