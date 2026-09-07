import { apiFetch } from "./client";
import type { ConnectionSummary, RevokeConnectionResponse } from "@orquestra/contracts";

export function listConnections(): Promise<ConnectionSummary[]> {
  return apiFetch<ConnectionSummary[]>("/connections");
}

export function createConnection(input: {
  connectorKey: string;
  name: string;
  auth: Record<string, unknown>;
}): Promise<ConnectionSummary> {
  return apiFetch<ConnectionSummary>("/connections", { method: "POST", body: input });
}

export function replaceConnectionSecret(
  id: string,
  auth: Record<string, unknown>
): Promise<ConnectionSummary> {
  return apiFetch<ConnectionSummary>(`/connections/${id}`, { method: "PATCH", body: { auth } });
}

export function revokeConnection(id: string): Promise<RevokeConnectionResponse> {
  return apiFetch<RevokeConnectionResponse>(`/connections/${id}/revoke`, { method: "POST" });
}

export function checkConnection(id: string): Promise<ConnectionSummary> {
  return apiFetch<ConnectionSummary>(`/connections/${id}/check`, { method: "POST" });
}
