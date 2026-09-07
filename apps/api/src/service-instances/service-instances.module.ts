import { Module } from "@nestjs/common";
import { ServiceInstancesController } from "./service-instances.controller";
import { BindingsController } from "./bindings.controller";
import { LifecycleController } from "./lifecycle.controller";

@Module({ controllers: [ServiceInstancesController, BindingsController, LifecycleController] })
export class ServiceInstancesModule {}
