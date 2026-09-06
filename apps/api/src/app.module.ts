import { DynamicModule, Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { ServiceInstancesModule } from "./service-instances/service-instances.module";
import type { AppConfig } from "./config/load-config";

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        HealthModule.register(config.DATABASE_URL),
        AuthModule,
        CatalogModule,
        ServiceInstancesModule
      ]
    };
  }
}
