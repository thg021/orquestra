import { apiFetch } from "./client";
import type { ConnectorBindingSummary } from "@orquestra/contracts";

export function listBindings(serviceInstanceId: string): Promise<ConnectorBindingSummary[]> {
  return apiFetch<ConnectorBindingSummary[]>(`/service-instances/${serviceInstanceId}/bindings`);
}

export function bindCapability(
  serviceInstanceId: string,
  capability: string,
  connectionId: string
): Promise<void> {
  return apiFetch<void>(`/service-instances/${serviceInstanceId}/bindings/${capability}`, {
    method: "PUT",
    body: { connectionId }
  });
}

export function unbindCapability(serviceInstanceId: string, capability: string): Promise<void> {
  return apiFetch<void>(`/service-instances/${serviceInstanceId}/bindings/${capability}`, { method: "DELETE" });
}
