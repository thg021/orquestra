import { ConflictException } from "@nestjs/common";
import { findAgentDefinition } from "@orquestra/catalog";
import {
  withTenant,
  listBindingsByInstance,
  findConnectorConnectionById,
  updateServiceInstanceStatus,
  type ServiceInstanceRow,
  type Tx
} from "@orquestra/db";
import { evaluateActivation, type GateCapabilityBinding, type GateResult } from "@orquestra/core";
import { getServiceInstance } from "./service-instances.service";

/**
 * Monta a entrada do gate a partir do estado real da instância — a única ponte entre
 * dados concretos (banco, catálogo) e a função pura que decide. Recebe a `Tx` já
 * aberta, em vez de abrir a própria via `withTenant`: o worker do M2 (T10) reavalia
 * o gate dentro da transação que já executa o run, e uma `withTenant` por binding
 * aqui dentro seria transação aninhada sem necessidade. Quem não tem transação
 * própria ainda (`activateServiceInstance`) abre uma por fora e passa para dentro.
 */
export async function evaluateInstanceActivation(
  tenantId: string,
  instance: ServiceInstanceRow,
  tx: Tx
): Promise<GateResult> {
  const agent = findAgentDefinition(instance.agentKey, instance.agentVersion);
  if (!agent) {
    return evaluateActivation({ agentVersionExists: false, configValid: false, capabilities: [] });
  }

  const configResult = agent.configSchema.safeParse(instance.config);
  const invalidConfigFields = configResult.success
    ? undefined
    : configResult.error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join(".") : "(raiz)"));

  const bindings = await listBindingsByInstance(instance.id, tx);
  const bindingByCapability = new Map(bindings.map((binding) => [binding.capability, binding]));

  const capabilities: GateCapabilityBinding[] = await Promise.all(
    agent.capabilities.map(async (requirement): Promise<GateCapabilityBinding> => {
      const binding = bindingByCapability.get(requirement.capability);
      if (!binding) {
        return {
          capability: requirement.capability,
          required: requirement.required,
          connectionId: undefined,
          connectionStatus: undefined
        };
      }
      const connection = await findConnectorConnectionById(binding.connectionId, tx);
      // Falha fechado: um binding sem conexão correspondente (não deveria acontecer —
      // conexão nunca é apagada de verdade — mas se acontecer, não é seguro assumir
      // "ativa" sem prova) trata como revogada, nunca como ativa por omissão.
      return {
        capability: requirement.capability,
        required: requirement.required,
        connectionId: binding.connectionId,
        connectionStatus: connection && connection.status !== "revoked" ? "active" : "revoked"
      };
    })
  );

  return evaluateActivation({
    agentVersionExists: true,
    configValid: configResult.success,
    ...(invalidConfigFields ? { invalidConfigFields } : {}),
    capabilities
  });
}

/** Reavalia o gate a cada chamada — nunca confia num "já passou uma vez" (BIND-03 a BIND-05). */
export async function activateServiceInstance(tenantId: string, id: string): Promise<ServiceInstanceRow> {
  const instance = await getServiceInstance(tenantId, id);
  const result = await withTenant(tenantId, (tx) => evaluateInstanceActivation(tenantId, instance, tx));

  if (!result.ok) {
    throw new ConflictException({
      code: "ACTIVATION_BLOCKED",
      message: "Não é possível ativar: há requisitos pendentes.",
      impediments: result.impediments
    });
  }

  await withTenant(tenantId, (tx) => updateServiceInstanceStatus(id, "active", null, tx));
  return getServiceInstance(tenantId, id);
}

/** Preserva config e vínculos — só muda o status (BIND-06). */
export async function pauseServiceInstance(tenantId: string, id: string): Promise<ServiceInstanceRow> {
  await getServiceInstance(tenantId, id);
  await withTenant(tenantId, (tx) => updateServiceInstanceStatus(id, "paused", null, tx));
  return getServiceInstance(tenantId, id);
}
