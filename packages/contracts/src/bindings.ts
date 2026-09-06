import { z } from "zod";

export const bindCapabilityRequestSchema = z.object({
  connectionId: z.string().min(1, "connectionId é obrigatório")
});
export type BindCapabilityRequest = z.infer<typeof bindCapabilityRequestSchema>;
