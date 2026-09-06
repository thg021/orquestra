import { hkdfSync } from "node:crypto";

const TENANT_KEY_LENGTH = 32;

/**
 * Chave do tenant: derivada da KEK por HKDF-SHA256, nunca persistida. `tenantId` é o
 * sal — isolamento entre tenants sem precisar custodiar uma chave por tenant — e a
 * versão da KEK entra no `info`, então a mesma KEK em versões diferentes deriva
 * chaves diferentes por construção.
 */
export function deriveTenantKey(kek: Buffer, tenantId: string, keyVersion: number): Buffer {
  const info = `orquestra:tenant-kek:v${keyVersion}`;
  const derived = hkdfSync(
    "sha256",
    kek,
    Buffer.from(tenantId, "utf8"),
    Buffer.from(info, "utf8"),
    TENANT_KEY_LENGTH
  );
  return Buffer.from(derived);
}
