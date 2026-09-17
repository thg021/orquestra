export { runMigrations } from "./migrate";
export type { RunMigrationsOptions } from "./migrate";
export * as identitySchema from "./schema/identity";
export * as serviceDataSchema from "./schema/service-data";
export * as serviceManagementSchema from "./schema/service-management";
export * as executionSchema from "./schema/execution";
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
  listConnectorConnections,
  updateConnectorConnectionSecret,
  revokeConnectorConnection,
  updateConnectorConnectionCheck
} from "./repositories/connector-connections.repository";
export type {
  ConnectorConnectionRow,
  InsertConnectorConnectionInput,
  UpdateConnectorConnectionSecretInput
} from "./repositories/connector-connections.repository";

export {
  bindConnectorCapability,
  unbindConnectorCapability,
  listBindingsByInstance,
  listBindingsByConnection
} from "./repositories/connector-bindings.repository";
export type { ConnectorBindingRow, BindConnectorCapabilityInput } from "./repositories/connector-bindings.repository";

export {
  insertServiceRun,
  findServiceRunById,
  listServiceRunsByInstance,
  transitionServiceRunStatus,
  IllegalRunTransitionError
} from "./repositories/service-runs.repository";
export type {
  ServiceRunRow,
  InsertServiceRunInput,
  TransitionServiceRunStatusOptions
} from "./repositories/service-runs.repository";

export { insertRunStep, listRunSteps, sumRunCost } from "./repositories/run-steps.repository";
export type { RunStepRow, InsertRunStepInput } from "./repositories/run-steps.repository";

export {
  createApprovalRequest,
  findApprovalRequestById,
  listPendingApprovalRequests,
  decideApprovalRequest,
  AlreadyDecidedError
} from "./repositories/approval-requests.repository";
export type { ApprovalRequestRow, CreateApprovalRequestInput } from "./repositories/approval-requests.repository";

export {
  insertDeliveryReceipt,
  findDeliveryReceipts,
  DuplicateDeliveryError
} from "./repositories/delivery-receipts.repository";
export type { InsertDeliveryReceiptInput } from "./repositories/delivery-receipts.repository";

export {
  upsertSchedule,
  findScheduleByInstance,
  deleteSchedule,
  claimDueSchedules
} from "./repositories/schedules.repository";
export type { ScheduleRow, UpsertScheduleInput } from "./repositories/schedules.repository";

export { createCheckpointSaver, UnsupportedCheckpointNamespaceError } from "./checkpointer";

