import { UnprocessableEntityException } from "@nestjs/common";
import type { z } from "zod";
import { AGENTS, findAgentDefinition } from "@orquestra/catalog";
import {
  withTenant,
  insertServiceInstance,
  findServiceInstanceById,
  listServiceInstances,
  updateServiceInstance,
  removeServiceInstance,
  type ServiceInstanceRow,
  type UpdateServiceInstanceInput
} from "@orquestra/db";
import { newId } from "@orquestra/core";
import type { UpdateServiceInstanceRequest } from "@orquestra/contracts";
import type { FieldError } from "../common/error.filter";
import { AgentNotFoundError, AgentVersionMissingError, ServiceInstanceNotFoundError } from "./errors";

/** Config inválida nunca grava — validação acontece antes de qualquer chamada ao repositório. */
function assertValidConfig(configSchema: z.ZodType, config: unknown): Record<string, unknown> {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    const fields: FieldError[] = parsed.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "(raiz)",
      message: issue.message
    }));
    throw new UnprocessableEntityException({
      code: "CONFIG_INVALID",
      message: "Configuração inválida.",
      fields
    });
  }
  return parsed.data as Record<string, unknown>;
}

export interface InstallServiceInstanceInput {
  agentKey: string;
  name: string;
  config: unknown;
}

/** Fixa chave e versão do agente no momento da instalação — nunca reavaliado depois (INST-01). */
export async function installServiceInstance(
  tenantId: string,
  input: InstallServiceInstanceInput
): Promise<ServiceInstanceRow> {
  const agent = AGENTS.find((candidate) => candidate.key === input.agentKey);
  if (!agent) {
    throw new AgentNotFoundError(input.agentKey);
  }

  const validatedConfig = assertValidConfig(agent.configSchema, input.config);

  const id = newId();
  await withTenant(tenantId, (tx) =>
    insertServiceInstance(
      {
        id,
        tenantId,
        agentKey: agent.key,
        agentVersion: agent.version,
        name: input.name,
        config: validatedConfig
      },
      tx
    )
  );

  return getServiceInstance(tenantId, id);
}

export async function listAllServiceInstances(tenantId: string): Promise<ServiceInstanceRow[]> {
  return withTenant(tenantId, (tx) => listServiceInstances(tx));
}

export async function getServiceInstance(tenantId: string, id: string): Promise<ServiceInstanceRow> {
  const found = await withTenant(tenantId, (tx) => findServiceInstanceById(id, tx));
  if (!found) {
    throw new ServiceInstanceNotFoundError(id);
  }
  return found;
}

/**
 * Valida a config contra o schema da VERSÃO FIXADA na instância (`agentVersion`), não
 * contra a versão mais recente do catálogo — são coisas diferentes assim que o
 * catálogo ganhar uma segunda versão do mesmo agente.
 */
export async function updateServiceInstanceById(
  tenantId: string,
  id: string,
  input: UpdateServiceInstanceRequest
): Promise<ServiceInstanceRow> {
  const existing = await getServiceInstance(tenantId, id);

  const changes: UpdateServiceInstanceInput = {};
  if (input.name !== undefined) {
    changes.name = input.name;
  }
  if (input.config !== undefined) {
    const agent = findAgentDefinition(existing.agentKey, existing.agentVersion);
    if (!agent) {
      throw new AgentVersionMissingError(existing.agentKey, existing.agentVersion);
    }
    changes.config = assertValidConfig(agent.configSchema, input.config);
  }

  await withTenant(tenantId, (tx) => updateServiceInstance(id, changes, tx));
  return getServiceInstance(tenantId, id);
}

/** Remoção lógica: a linha e os vínculos ficam; some só da listagem padrão (INST-05, INST-06). */
export async function removeServiceInstanceById(tenantId: string, id: string): Promise<void> {
  await getServiceInstance(tenantId, id);
  await withTenant(tenantId, (tx) => removeServiceInstance(id, tx));
}
