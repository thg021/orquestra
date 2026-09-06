import type { KekSet } from "./kek";
import type { SealedSecret } from "./seal";
import { deriveTenantKey } from "./derive-tenant-key";
import { encrypt, decrypt, dekAad } from "./gcm";

/**
 * Abre a DEK sob a versão de KEK atual da conexão e a recifra sob outra versão —
 * nunca toca `secretEnvelope`. É o que sustenta a rotação incremental do ADR-001:
 * trocar a KEK custa recifrar uma DEK de 32 bytes por conexão, não decifrar e recifrar
 * cada segredo. Idempotente: rodar duas vezes sobre o mesmo `sealed` original produz,
 * nas duas vezes, uma DEK utilizável sob `toVersion` — não há estado a corromper.
 */
export function rewrapDek(
  keks: KekSet,
  tenantId: string,
  connectionId: string,
  sealed: SealedSecret,
  toVersion: number
): SealedSecret {
  const fromKek = keks.get(sealed.keyVersion);
  const fromTenantKey = deriveTenantKey(fromKek, tenantId, sealed.keyVersion);
  const dek = decrypt(fromTenantKey, sealed.dekEnvelope, dekAad(tenantId, connectionId, sealed.keyVersion));

  const toKek = keks.get(toVersion);
  const toTenantKey = deriveTenantKey(toKek, tenantId, toVersion);
  const dekEnvelope = encrypt(toTenantKey, dek, dekAad(tenantId, connectionId, toVersion));

  return {
    secretEnvelope: sealed.secretEnvelope,
    dekEnvelope,
    keyVersion: toVersion,
    last4: sealed.last4
  };
}
