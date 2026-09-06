import { eq, lt } from "drizzle-orm";
import {
  withTenant,
  withoutTenant,
  identitySchema,
  serviceManagementSchema,
  type Tx
} from "@orquestra/db";
import { loadKeks, createVault, type KekSet, type Vault } from "@orquestra/core";

export interface KekRotateArgs {
  toVersion: number;
  kekDir: string;
}

export interface KekRotateDeps {
  loadKeksFn?: (dirPath: string) => KekSet;
  createVaultFn?: (keks: KekSet) => Vault;
}

export interface KekRotateResult {
  tenantsScanned: number;
  connectionsRewrapped: number;
}

const { connectorConnections } = serviceManagementSchema;

async function listTenantIds(): Promise<string[]> {
  return withoutTenant(async (tx) => {
    const rows = await tx.select({ id: identitySchema.tenants.id }).from(identitySchema.tenants);
    return rows.map((row) => row.id);
  });
}

async function rewrapOneConnection(
  vault: Vault,
  tenantId: string,
  connectionId: string,
  toVersion: number
): Promise<boolean> {
  return withTenant(tenantId, async (tx: Tx) => {
    const rows = await tx.select().from(connectorConnections).where(eq(connectorConnections.id, connectionId));
    const row = rows[0];
    // Já rotacionada por uma execução anterior (retomando depois de interrupção) —
    // sem trabalho a fazer, sem erro.
    if (!row || row.keyVersion >= toVersion) return false;

    const rewrapped = vault.rewrapDek(
      tenantId,
      connectionId,
      {
        secretEnvelope: row.secretEnvelope,
        dekEnvelope: row.dekEnvelope,
        keyVersion: row.keyVersion,
        last4: row.last4
      },
      toVersion
    );

    await tx
      .update(connectorConnections)
      .set({ dekEnvelope: rewrapped.dekEnvelope, keyVersion: rewrapped.keyVersion, updatedAt: new Date() })
      .where(eq(connectorConnections.id, connectionId));

    return true;
  });
}

/**
 * Percorre as conexões de todo tenant com `key_version` abaixo de `toVersion` e
 * recifra a DEK de cada uma — nunca o `secret_envelope` (T7). Cada conexão é uma
 * transação própria: interromper no meio deixa parte já em `toVersion` e parte ainda
 * na versão antiga, e ambas continuam legíveis, porque a KEK antiga segue carregada
 * enquanto convivem. Rodar de novo é seguro — a consulta por `key_version < toVersion`
 * já pula sozinha o que uma execução anterior deixou pronto.
 */
export async function runKekRotate(args: KekRotateArgs, deps: KekRotateDeps = {}): Promise<KekRotateResult> {
  const loadKeksFn = deps.loadKeksFn ?? loadKeks;
  const createVaultFn = deps.createVaultFn ?? createVault;

  const keks = loadKeksFn(args.kekDir);
  if (keks.currentVersion < args.toVersion) {
    throw new Error(
      `Versão alvo ${args.toVersion} não está disponível em "${args.kekDir}" (versão corrente carregada: ${keks.currentVersion}).`
    );
  }
  const vault = createVaultFn(keks);

  const tenantIds = await listTenantIds();
  let connectionsRewrapped = 0;

  for (const tenantId of tenantIds) {
    const pendingIds = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: connectorConnections.id })
        .from(connectorConnections)
        .where(lt(connectorConnections.keyVersion, args.toVersion));
      return rows.map((row) => row.id);
    });

    for (const connectionId of pendingIds) {
      const rewrapped = await rewrapOneConnection(vault, tenantId, connectionId, args.toVersion);
      if (rewrapped) connectionsRewrapped += 1;
    }
  }

  return { tenantsScanned: tenantIds.length, connectionsRewrapped };
}
