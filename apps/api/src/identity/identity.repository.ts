import { eq, asc } from "drizzle-orm";
import { withoutTenant, identitySchema, type Tx } from "@orquestra/db";
import { newId, DuplicateTenantNameError, type Role } from "@orquestra/core";

const { tenants, users, memberships } = identitySchema;

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
}

export interface ActiveMembership {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  userId: string;
  role: Role;
}

export interface CreateTenantWithOwnerInput {
  tenantName: string;
  email: string;
  passwordHash: string;
}

export interface CreateTenantWithOwnerResult {
  tenantId: string;
  userId: string;
  membershipId: string;
}

/** trim + lowercase — a mesma normalização em toda a cadeia de identidade (busca, criação, throttle). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505" &&
    "constraint" in error &&
    (error as { constraint?: string }).constraint === constraint
  );
}

async function runInTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : withoutTenant(fn);
}

export async function findUserByEmail(email: string, tx?: Tx): Promise<UserRow | undefined> {
  return runInTx(tx, async (t) => {
    const rows = await t
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .limit(1);
    return rows[0];
  });
}

export async function findUserById(userId: string, tx?: Tx): Promise<UserRow | undefined> {
  return runInTx(tx, async (t) => {
    const rows = await t
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0];
  });
}

export async function updateUserPassword(userId: string, passwordHash: string, tx?: Tx): Promise<void> {
  await runInTx(tx, async (t) => {
    await t.update(users).set({ passwordHash }).where(eq(users.id, userId));
  });
}

/**
 * Vínculo ativo do usuário: o mais antigo, de forma determinística (createdAt, com
 * desempate por id) — não há seletor de tenant na interface, então a eleição precisa
 * ser sempre a mesma para o mesmo usuário (AUTH-04, edge case de múltiplos vínculos).
 */
export async function findActiveMembership(
  userId: string,
  tx?: Tx
): Promise<ActiveMembership | undefined> {
  return runInTx(tx, async (t) => {
    const rows = await t
      .select({
        membershipId: memberships.id,
        tenantId: memberships.tenantId,
        tenantName: tenants.name,
        userId: memberships.userId,
        role: memberships.role
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt), asc(memberships.id))
      .limit(1);
    return rows[0] as ActiveMembership | undefined;
  });
}

/**
 * Cria tenant + (usuário novo ou vinculado a um existente) + membership owner, tudo
 * numa única transação. Nome de tenant duplicado é pego pela constraint única do banco
 * (não por um SELECT prévio, que teria corrida entre criações concorrentes) e traduzido
 * para DuplicateTenantNameError.
 */
export async function createTenantWithOwner(
  input: CreateTenantWithOwnerInput
): Promise<CreateTenantWithOwnerResult> {
  return withoutTenant(async (tx) => {
    const normalizedEmail = normalizeEmail(input.email);

    const existingUser = await findUserByEmail(normalizedEmail, tx);
    const userId = existingUser?.id ?? newId();
    if (!existingUser) {
      await tx.insert(users).values({ id: userId, email: normalizedEmail, passwordHash: input.passwordHash });
    }

    const tenantId = newId();
    try {
      await tx.insert(tenants).values({ id: tenantId, name: input.tenantName });
    } catch (error) {
      if (isUniqueViolation(error, "tenants_name_unique")) {
        throw new DuplicateTenantNameError(input.tenantName);
      }
      throw error;
    }

    const membershipId = newId();
    await tx.insert(memberships).values({ id: membershipId, tenantId, userId, role: "owner" });

    return { tenantId, userId, membershipId };
  });
}
