import { z } from "zod";

export const createConnectionRequestSchema = z.object({
  connectorKey: z.string().min(1, "Chave do conector é obrigatória"),
  name: z.string().min(1, "Nome é obrigatório"),
  // Campos secretos e não-secretos convivem aqui — a separação usa secretFields/
  // metadataFields do catálogo, não este contrato (mesma convenção de config.ts).
  auth: z.record(z.string(), z.unknown()).default({})
});
export type CreateConnectionRequest = z.infer<typeof createConnectionRequestSchema>;

export const replaceConnectionSecretRequestSchema = z.object({
  auth: z.record(z.string(), z.unknown()).default({})
});
export type ReplaceConnectionSecretRequest = z.infer<typeof replaceConnectionSecretRequestSchema>;

export const connectionSummarySchema = z.object({
  id: z.string(),
  connectorKey: z.string(),
  name: z.string(),
  metadata: z.unknown(),
  last4: z.string(),
  status: z.string(),
  lastCheckStatus: z.string().nullable(),
  lastCheckAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const listConnectionsResponseSchema = z.array(connectionSummarySchema);

// Design §Tratamento de erros: "Conexão revogada. N serviços foram pausados." —
// o painel precisa do número pra montar essa mensagem (ROT-01/ROT-02).
export const revokeConnectionResponseSchema = connectionSummarySchema.extend({
  pausedInstanceCount: z.number()
});
export type RevokeConnectionResponse = z.infer<typeof revokeConnectionResponseSchema>;
