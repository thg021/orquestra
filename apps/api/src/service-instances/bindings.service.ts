import { BadRequestException } from "@nestjs/common";
import { CONNECTORS, isCapability } from "@orquestra/catalog";
import {
  withTenant,
  bindConnectorCapability,
  unbindConnectorCapability,
  findConnectorConnectionById,
  listBindingsByInstance,
  type ConnectorBindingRow
} from "@orquestra/db";
import { getServiceInstance } from "./service-instances.service";
import { ConnectorConnectionNotFoundError, CapabilityMismatchError } from "./errors";

/** Serve à aba "Conexões" do painel (T21) — o vínculo atual de cada capability. */
export async function listBindings(tenantId: string, serviceInstanceId: string): Promise<ConnectorBindingRow[]> {
  await getServiceInstance(tenantId, serviceInstanceId);
  return withTenant(tenantId, (tx) => listBindingsByInstance(serviceInstanceId, tx));
}

/**
 * Liga uma capability da instância a uma conexão — só aceita conexão cujo conector
 * entregue exatamente essa capability (BIND-01). Ligar de novo substitui, sem criar
 * segunda linha (BIND-02) — quem garante isso é o `ON CONFLICT` do repositório (T10).
 */
export async function bindCapability(
  tenantId: string,
  serviceInstanceId: string,
  capability: string,
  connectionId: string
): Promise<void> {
  if (!isCapability(capability)) {
    throw new BadRequestException({ code: "INVALID_CAPABILITY" });
  }

  // 404 se a instância não existir ou for de outro tenant — getServiceInstance já
  // resolve isso via withTenant (RLS).
  await getServiceInstance(tenantId, serviceInstanceId);

  // Mesma lógica para a conexão: RLS faz uma conexão de outro tenant parecer
  // inexistente por conta própria, sem checagem extra aqui — é o que torna os dois
  // casos ("não existe" e "é de outro tenant") indistinguíveis para quem chama.
  const connection = await withTenant(tenantId, (tx) => findConnectorConnectionById(connectionId, tx));
  if (!connection) {
    throw new ConnectorConnectionNotFoundError(connectionId);
  }

  const connector = CONNECTORS.find((candidate) => candidate.key === connection.connectorKey);
  if (!connector || connector.capability !== capability) {
    throw new CapabilityMismatchError(connection.connectorKey, capability, connector?.capability ?? "desconhecida");
  }

  await withTenant(tenantId, (tx) =>
    bindConnectorCapability({ tenantId, serviceInstanceId, capability, connectionId }, tx)
  );
}

export async function unbindCapability(
  tenantId: string,
  serviceInstanceId: string,
  capability: string
): Promise<void> {
  await getServiceInstance(tenantId, serviceInstanceId);
  await withTenant(tenantId, (tx) => unbindConnectorCapability(serviceInstanceId, capability, tx));
}
