import { Module } from "@nestjs/common";
import { ServiceInstancesController } from "./service-instances.controller";

@Module({ controllers: [ServiceInstancesController] })
export class ServiceInstancesModule {}
