import { z } from "zod";

export const bindCapabilityRequestSchema = z.object({
  connectionId: z.string().min(1, "connectionId é obrigatório")
});
export type BindCapabilityRequest = z.infer<typeof bindCapabilityRequestSchema>;

// Serve à aba "Conexões" do painel (T21) — o vínculo atual de cada capability.
export const connectorBindingSummarySchema = z.object({
  capability: z.string(),
  connectionId: z.string()
});
export type ConnectorBindingSummary = z.infer<typeof connectorBindingSummarySchema>;

export const listBindingsResponseSchema = z.array(connectorBindingSummarySchema);
