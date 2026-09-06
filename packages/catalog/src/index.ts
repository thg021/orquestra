export { CAPABILITIES, isCapability } from "./capabilities";
export type { Capability } from "./capabilities";
export { defineAgent, defineConnector, CONNECTOR_KINDS, AUTH_KINDS } from "./define";
export type {
  AgentDefinition,
  AgentDefinitionInput,
  ConnectorDefinition,
  ConnectorDefinitionInput,
  CapabilityRequirement,
  DataCollection,
  ConnectorKind,
  AuthKind
} from "./define";
export { secret, isSecret } from "./secret";
export { InvalidDefinitionError } from "./errors";
export { toFormSchema, checkFormSchemaSupport } from "./json-schema";
export type { FormSchemaSupport } from "./json-schema";
export { validateCatalog } from "./validate";
export type { CatalogIssue, CatalogInput } from "./validate";

export { accountingRoutine } from "./agents/accounting-routine";
export { platformUpload } from "./connectors/platform-upload";
export { onedrive } from "./connectors/onedrive";
export { googleDrive } from "./connectors/google-drive";
export { gmail } from "./connectors/gmail";
export { whatsapp } from "./connectors/whatsapp";
export { fortesConecta } from "./connectors/fortes-conecta";

export { AGENTS, CONNECTORS, validateBuiltinCatalog, findAgentDefinition } from "./catalog";
