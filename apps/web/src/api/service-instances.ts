import { apiFetch } from "./client";
import type {
  ServiceInstanceSummary,
  CreateServiceInstanceRequest,
  UpdateServiceInstanceRequest
} from "@orquestra/contracts";

export function listServiceInstances(): Promise<ServiceInstanceSummary[]> {
  return apiFetch<ServiceInstanceSummary[]>("/service-instances");
}

export function getServiceInstance(id: string): Promise<ServiceInstanceSummary> {
  return apiFetch<ServiceInstanceSummary>(`/service-instances/${id}`);
}

export function createServiceInstance(input: CreateServiceInstanceRequest): Promise<ServiceInstanceSummary> {
  return apiFetch<ServiceInstanceSummary>("/service-instances", { method: "POST", body: input });
}

export function updateServiceInstance(
  id: string,
  input: UpdateServiceInstanceRequest
): Promise<ServiceInstanceSummary> {
  return apiFetch<ServiceInstanceSummary>(`/service-instances/${id}`, { method: "PATCH", body: input });
}

export function activateServiceInstance(id: string): Promise<ServiceInstanceSummary> {
  return apiFetch<ServiceInstanceSummary>(`/service-instances/${id}/activate`, { method: "POST" });
}

export function pauseServiceInstance(id: string): Promise<ServiceInstanceSummary> {
  return apiFetch<ServiceInstanceSummary>(`/service-instances/${id}/pause`, { method: "POST" });
}
