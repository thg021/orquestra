import { z } from "zod";

export const createServiceInstanceRequestSchema = z.object({
  agentKey: z.string().min(1, "Chave do agente é obrigatória"),
  name: z.string().min(1, "Nome é obrigatório"),
  // O formato de config é específico de cada agente — a validação profunda usa o
  // configSchema do catálogo, não este contrato (que só garante que é um objeto).
  config: z.record(z.string(), z.unknown()).default({})
});
export type CreateServiceInstanceRequest = z.infer<typeof createServiceInstanceRequestSchema>;

export const updateServiceInstanceRequestSchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional()
});
export type UpdateServiceInstanceRequest = z.infer<typeof updateServiceInstanceRequestSchema>;

export const serviceInstanceSummarySchema = z.object({
  id: z.string(),
  agentKey: z.string(),
  agentVersion: z.string(),
  name: z.string(),
  config: z.unknown(),
  status: z.string(),
  statusReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ServiceInstanceSummary = z.infer<typeof serviceInstanceSummarySchema>;

export const listServiceInstancesResponseSchema = z.array(serviceInstanceSummarySchema);
