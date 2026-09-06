import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  ServiceUnavailableException
} from "@nestjs/common";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  // @Inject explícito: a injeção implícita por design:paramtypes exige que o código
  // rodado tenha passado por `tsc` de verdade (emitDecoratorMetadata). O Vitest
  // transpila via esbuild, que não emite essa metadata — @Inject funciona igual sob
  // qualquer transformer, então é o padrão adotado em toda a API.
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  /** Liveness: o processo está de pé. Nunca toca o banco — não deve falhar junto com ele. */
  @Get("live")
  @HttpCode(HttpStatus.OK)
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: migrações aplicadas E Postgres respondendo agora. */
  @Get("ready")
  async ready(): Promise<{ status: "ok" }> {
    const isReady = await this.healthService.isReady();
    if (!isReady) {
      throw new ServiceUnavailableException({ status: "not_ready" });
    }
    return { status: "ok" };
  }
}
