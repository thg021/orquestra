import { DynamicModule, Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({})
export class HealthModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useFactory: () => new HealthService(databaseUrl)
        }
      ],
      exports: [HealthService]
    };
  }
}
