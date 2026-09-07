import { z } from "zod";

// Capability e tipos de conector duplicados de @orquestra/catalog deliberadamente:
// contracts precisa ser seguro para o bundle do painel, e catalog carrega os
// construtores de definição (defineAgent/defineConnector) que o web nunca usa. Mesma
// razão da duplicação de roleSchema em auth.ts.
const capabilitySchema = z.enum(["file-storage", "email", "messaging", "document-delivery"]);

const capabilityRequirementSchema = z.object({
  capability: capabilitySchema,
  required: z.boolean()
});

/**
 * O `configSchema`/`authSchema` chegam como JSON Schema — o formato que o
 * renderizador do painel (T20) consome. Não validamos a estrutura aqui: quem garante
 * que ele cabe no subconjunto suportado é `checkFormSchemaSupport`, do lado do servidor.
 */
export const agentSummarySchema = z.object({
  key: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  capabilities: z.array(capabilityRequirementSchema),
  configSchema: z.unknown()
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const connectorSummarySchema = z.object({
  key: z.string(),
  title: z.string(),
  capability: capabilitySchema,
  kind: z.enum(["native", "mcp"]),
  authKind: z.enum(["api_key", "oauth", "form"]),
  authSchema: z.unknown()
});
export type ConnectorSummary = z.infer<typeof connectorSummarySchema>;

export const catalogAgentsResponseSchema = z.array(agentSummarySchema);
export const catalogConnectorsResponseSchema = z.array(connectorSummarySchema);
