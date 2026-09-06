import { hashPassword, assertPasswordPolicy } from "@orquestra/core";
import { createTenantWithOwner } from "../../identity/identity.repository";

export interface TenantCreateArgs {
  name: string;
  email: string;
  password: string;
}

export interface TenantCreateResult {
  tenantId: string;
  userId: string;
}

/**
 * Senha abaixo do mínimo recusa antes de qualquer hash ou escrita; nome de tenant
 * duplicado é pego pela constraint única dentro de createTenantWithOwner (transação
 * única, sem deixar usuário novo órfão).
 */
export async function runTenantCreate(args: TenantCreateArgs): Promise<TenantCreateResult> {
  assertPasswordPolicy(args.password);
  const passwordHash = await hashPassword(args.password);
  return createTenantWithOwner({ tenantName: args.name, email: args.email, passwordHash });
}
