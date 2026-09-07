export { runMigrations } from "./migrate";
export type { RunMigrationsOptions } from "./migrate";
export * as identitySchema from "./schema/identity";
export * as serviceDataSchema from "./schema/service-data";
export * as serviceManagementSchema from "./schema/service-management";
export { withTenant, withoutTenant, getTenantId } from "./tenant-context";
export type { Tx } from "./tenant-context";
// Só o encerramento do pool é público (shutdown gracioso do processo / limpeza de
// teste) — nunca o Pool em si, que continua só acessível de dentro do pacote.
export { closeDefaultPool } from "./pool";

export {
  insertServiceInstance,
  findServiceInstanceById,
  listServiceInstances,
  updateServiceInstance,
  updateServiceInstanceStatus,
  removeServiceInstance
} from "./repositories/service-instances.repository";
export type {
  ServiceInstanceRow,
  InsertServiceInstanceInput,
  UpdateServiceInstanceInput
} from "./repositories/service-instances.repository";

export {
  insertConnectorConnection,
  findConnectorConnectionById,
  findConnectorConnectionByName,
  listConnectorConnections
} from "./repositories/connector-connections.repository";
export type {
  ConnectorConnectionRow,
  InsertConnectorConnectionInput
} from "./repositories/connector-connections.repository";

export {
  bindConnectorCapability,
  unbindConnectorCapability,
  listBindingsByInstance,
  listBindingsByConnection
} from "./repositories/connector-bindings.repository";
export type { ConnectorBindingRow, BindConnectorCapabilityInput } from "./repositories/connector-bindings.repository";

