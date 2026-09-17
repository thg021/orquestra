import { DynamicModule, Module } from "@nestjs/common";
import type { KekSet } from "@orquestra/core";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { ServiceInstancesModule } from "./service-instances/service-instances.module";
import { ConnectionsModule } from "./connections/connections.module";
import { ExecutionModule } from "./execution/execution.module";
import type { AppConfig } from "./config/load-config";

@Module({})
export class AppModule {
  static register(config: AppConfig, kekSet: KekSet): DynamicModule {
    return {
      module: AppModule,
      imports: [
        HealthModule.register(config.DATABASE_URL),
        AuthModule,
        CatalogModule,
        ServiceInstancesModule,
        ConnectionsModule.register(kekSet),
        ExecutionModule.register(config.REDIS_URL)
      ]
    };
  }
}
