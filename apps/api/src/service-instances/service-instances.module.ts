import { Module } from "@nestjs/common";
import { ServiceInstancesController } from "./service-instances.controller";
import { BindingsController } from "./bindings.controller";

@Module({ controllers: [ServiceInstancesController, BindingsController] })
export class ServiceInstancesModule {}
