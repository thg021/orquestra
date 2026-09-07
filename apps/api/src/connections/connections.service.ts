import { UnprocessableEntityException } from "@nestjs/common";
import { findAgentDefinition, CONNECTORS } from "@orquestra/catalog";
import {
  withTenant,
  insertConnectorConnection,
  findConnectorConnectionById,
  findConnectorConnectionByName,
  listConnectorConnections,
  updateConnectorConnectionSecret,
  revokeConnectorConnection,
  updateConnectorConnectionCheck,
  findServiceInstanceById,
  updateServiceInstanceStatus,
  listBindingsByConnection,
  type ConnectorConnectionRow
} from "@orquestra/db";
import { newId, type Vault } from "@orquestra/core";
import type { FieldError } from "../common/error.filter";
import { ConnectorNotFoundError, ConnectionNameDuplicateError } from "./errors";
import { ConnectorConnectionNotFoundError } from "../service-instances/errors";

export interface CreateConnectionInput {
  connectorKey: string;
  name: string;
  auth: Record<string, unknown>;
}

function assertValidAuth(connector: (typeof CONNECTORS)[number], auth: unknown): Record<string, unknown> {
  const parsed = connector.authSchema.safeParse(auth);
  if (!parsed.success) {
    const fields: FieldError[] = parsed.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "(raiz)",
      message: issue.message
    }));
    throw new UnprocessableEntityException({ code: "AUTH_INVALID", message: "Credencial inválida.", fields });
  }
  return parsed.data as Record<string, unknown>;
}

/** Separa o que vai cifrado (secretFields) do que fica legível em `metadata` (metadataFields) — a marca `secret()` no catálogo decide, nunca o nome do campo. */
function splitAuth(
  connector: (typeof CONNECTORS)[number],
  auth: Record<string, unknown>
): { metadata: Record<string, unknown>; secretValues: Record<string, unknown>; primarySecretValue: string } {
  const metadata: Record<string, unknown> = {};
  for (const field of connector.metadataFields) {
    metadata[field] = auth[field];
  }

  const secretValues: Record<string, unknown> = {};
  for (const field of connector.secretFields) {
    secretValues[field] = auth[field];
  }

  const primarySecretValue = String(auth[connector.secretFields[0] as string]);
  return { metadata, secretValues, primarySecretValue };
}

function findConnector(connectorKey: string): (typeof CONNECTORS)[number] {
  const connector = CONNECTORS.find((candidate) => candidate.key === connectorKey);
  if (!connector) {
    throw new ConnectorNotFoundError(connectorKey);
  }
  return connector;
}

/**
 * Nome duplicado é checado ANTES de qualquer cifragem (SEC-05): não vale a pena
 * cifrar um segredo que a inserção vai recusar de qualquer jeito.
 */
export async function installConnection(
  vault: Vault,
  tenantId: string,
  input: CreateConnectionInput
): Promise<ConnectorConnectionRow> {
  const connector = findConnector(input.connectorKey);

  const existing = await withTenant(tenantId, (tx) =>
    findConnectorConnectionByName(connector.key, input.name, tx)
  );
  if (existing) {
    throw new ConnectionNameDuplicateError();
  }

  const auth = assertValidAuth(connector, input.auth);
  const { metadata, secretValues, primarySecretValue } = splitAuth(connector, auth);

  const id = newId();
  const sealed = vault.seal(tenantId, id, JSON.stringify(secretValues));

  await withTenant(tenantId, (tx) =>
    insertConnectorConnection(
      {
        id,
        tenantId,
        connectorKey: connector.key,
        name: input.name,
        metadata,
        secretEnvelope: sealed.secretEnvelope,
        dekEnvelope: sealed.dekEnvelope,
        keyVersion: sealed.keyVersion,
        last4: primarySecretValue.slice(-4)
      },
      tx
    )
  );

  return getConnection(tenantId, id);
}

/** PATCH (ROT-03): troca só o segredo — nome e vínculos existentes ficam intactos (o `id` não muda). */
export async function replaceConnectionSecret(
  vault: Vault,
  tenantId: string,
  id: string,
  auth: Record<string, unknown>
): Promise<ConnectorConnectionRow> {
  const existing = await getConnection(tenantId, id);
  const connector = findConnector(existing.connectorKey);

  const validatedAuth = assertValidAuth(connector, auth);
  const { metadata, secretValues, primarySecretValue } = splitAuth(connector, validatedAuth);

  const sealed = vault.seal(tenantId, id, JSON.stringify(secretValues));

  await withTenant(tenantId, (tx) =>
    updateConnectorConnectionSecret(
      id,
      {
        secretEnvelope: sealed.secretEnvelope,
        dekEnvelope: sealed.dekEnvelope,
        keyVersion: sealed.keyVersion,
        last4: primarySecretValue.slice(-4),
        metadata
      },
      tx
    )
  );

  return getConnection(tenantId, id);
}

/**
 * Revogação (ROT-01, ROT-02) — nunca bloqueada por dependência. Tudo numa única
 * transação: revoga a conexão e, para cada instância ativa que dependia dela,
 * pausa só quem perdeu uma capability OBRIGATÓRIA (design §Revogação) — quem usava
 * como opcional segue ativa.
 */
export interface RevokeConnectionResult {
  connection: ConnectorConnectionRow;
  pausedInstanceCount: number;
}

export async function revokeConnection(tenantId: string, id: string): Promise<RevokeConnectionResult> {
  await getConnection(tenantId, id);

  const pausedInstanceCount = await withTenant(tenantId, async (tx) => {
    await revokeConnectorConnection(id, tx);

    const bindings = await listBindingsByConnection(id, tx);
    let paused = 0;
    for (const binding of bindings) {
      const instance = await findServiceInstanceById(binding.serviceInstanceId, tx);
      if (!instance || instance.status !== "active") continue;

      const agent = findAgentDefinition(instance.agentKey, instance.agentVersion);
      const requirement = agent?.capabilities.find((candidate) => candidate.capability === binding.capability);
      if (requirement?.required) {
        await updateServiceInstanceStatus(instance.id, "paused", "conexão revogada", tx);
        paused += 1;
      }
    }
    return paused;
  });

  const connection = await getConnection(tenantId, id);
  return { connection, pausedInstanceCount };
}

/**
 * Verificação (T18, CHK-01/CHK-02) — no M1 sempre grava `unverified`, atrás da mesma
 * interface que o adapter real do M3 vai preencher (sem mudar rota nem DTO).
 */
export async function checkConnection(tenantId: string, id: string): Promise<ConnectorConnectionRow> {
  await getConnection(tenantId, id);
  await withTenant(tenantId, (tx) => updateConnectorConnectionCheck(id, "unverified", tx));
  return getConnection(tenantId, id);
}

export async function listAllConnections(tenantId: string): Promise<ConnectorConnectionRow[]> {
  return withTenant(tenantId, (tx) => listConnectorConnections(tx));
}

export async function getConnection(tenantId: string, id: string): Promise<ConnectorConnectionRow> {
  const found = await withTenant(tenantId, (tx) => findConnectorConnectionById(id, tx));
  if (!found) {
    throw new ConnectorConnectionNotFoundError(id);
  }
  return found;
}
