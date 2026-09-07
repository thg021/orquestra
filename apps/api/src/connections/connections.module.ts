import { DynamicModule, Module } from "@nestjs/common";
import { createVault, type KekSet } from "@orquestra/core";
import { ConnectionsController } from "./connections.controller";
import { VAULT } from "./connections.constants";

@Module({})
export class ConnectionsModule {
  static register(kekSet: KekSet): DynamicModule {
    return {
      module: ConnectionsModule,
      controllers: [ConnectionsController],
      providers: [{ provide: VAULT, useFactory: () => createVault(kekSet) }]
    };
  }
}
