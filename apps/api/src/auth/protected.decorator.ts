import { applyDecorators, UseGuards, UseInterceptors } from "@nestjs/common";
import { SessionGuard } from "./session.guard";
import { TenantScopeInterceptor } from "./tenant-scope.interceptor";

/**
 * Combina SessionGuard + TenantScopeInterceptor — os dois sempre andam juntos numa
 * rota protegida. Existe para que aplicar só um dos dois (esquecendo o outro) não seja
 * um erro fácil de cometer numa rota nova.
 */
export function Protected(): ClassDecorator & MethodDecorator {
  return applyDecorators(UseGuards(SessionGuard), UseInterceptors(TenantScopeInterceptor));
}
