import { apiFetch } from "./client";
import type { AgentSummary, ConnectorSummary } from "@orquestra/contracts";

export function getAgents(): Promise<AgentSummary[]> {
  return apiFetch<AgentSummary[]>("/catalog/agents");
}

export function getConnectors(): Promise<ConnectorSummary[]> {
  return apiFetch<ConnectorSummary[]>("/catalog/connectors");
}
