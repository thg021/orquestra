import { z } from "zod";

export const serviceRunSummarySchema = z.object({
  id: z.string(),
  serviceInstanceId: z.string(),
  trigger: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ServiceRunSummary = z.infer<typeof serviceRunSummarySchema>;
