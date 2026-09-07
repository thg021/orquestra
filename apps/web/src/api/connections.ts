import { apiFetch } from "./client";
import type { ConnectionSummary } from "@orquestra/contracts";

export function listConnections(): Promise<ConnectionSummary[]> {
  return apiFetch<ConnectionSummary[]>("/connections");
}
