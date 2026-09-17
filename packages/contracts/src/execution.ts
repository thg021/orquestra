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

export const approvalRequestSummarySchema = z.object({
  id: z.string(),
  runId: z.string(),
  payload: z.unknown(),
  status: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string()
});
export type ApprovalRequestSummary = z.infer<typeof approvalRequestSummarySchema>;
