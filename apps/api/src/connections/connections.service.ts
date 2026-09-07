import { UnprocessableEntityException } from "@nestjs/common";
import { CONNECTORS } from "@orquestra/catalog";
import {
  withTenant,
  insertConnectorConnection,
  findConnectorConnectionById,
  findConnectorConnectionByName,
  listConnectorConnections,
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

/**
 * Separa o que vai cifrado (secretFields) do que fica legível em `metadata`
 * (metadataFields) — a marca `secret()` no catálogo decide, nunca o nome do campo.
 * Nome duplicado é checado ANTES de qualquer cifragem (SEC-05): não vale a pena
 * cifrar um segredo que a inserção vai recusar de qualquer jeito.
 */
export async function installConnection(
  vault: Vault,
  tenantId: string,
  input: CreateConnectionInput
): Promise<ConnectorConnectionRow> {
  const connector = CONNECTORS.find((candidate) => candidate.key === input.connectorKey);
  if (!connector) {
    throw new ConnectorNotFoundError(input.connectorKey);
  }

  const existing = await withTenant(tenantId, (tx) =>
    findConnectorConnectionByName(connector.key, input.name, tx)
  );
  if (existing) {
    throw new ConnectionNameDuplicateError();
  }

  const auth = assertValidAuth(connector, input.auth);

  const metadata: Record<string, unknown> = {};
  for (const field of connector.metadataFields) {
    metadata[field] = auth[field];
  }

  const secretValues: Record<string, unknown> = {};
  for (const field of connector.secretFields) {
    secretValues[field] = auth[field];
  }

  const id = newId();
  const sealed = vault.seal(tenantId, id, JSON.stringify(secretValues));
  const primarySecretValue = String(auth[connector.secretFields[0] as string]);

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
