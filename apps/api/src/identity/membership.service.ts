import { eq, and } from "drizzle-orm";
import { withoutTenant, identitySchema, type Tx } from "@orquestra/db";
import { LastOwnerError, type Role } from "@orquestra/core";

const { memberships } = identitySchema;

async function runInTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : withoutTenant(fn);
}

async function countOwners(tenantId: string, tx: Tx): Promise<number> {
  const rows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")));
  return rows.length;
}

async function getMembershipOrThrow(membershipId: string, tx: Tx) {
  const rows = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
  const membership = rows[0];
  if (!membership) {
    throw new Error(`Membership ${membershipId} não encontrado.`);
  }
  return membership;
}

/**
 * Recusa a operação se `membershipId` for o último `owner` do tenant — não importa se
 * a operação é remoção ou rebaixamento, o efeito final ("deixar de ser owner") é o
 * mesmo e a regra é a mesma (ROLE-03).
 */
async function assertNotLastOwner(membershipId: string, tx: Tx): Promise<void> {
  const membership = await getMembershipOrThrow(membershipId, tx);
  if (membership.role !== "owner") {
    return;
  }
  const ownerCount = await countOwners(membership.tenantId, tx);
  if (ownerCount <= 1) {
    throw new LastOwnerError();
  }
}

export async function removeMembership(membershipId: string, tx?: Tx): Promise<void> {
  await runInTx(tx, async (t) => {
    await assertNotLastOwner(membershipId, t);
    await t.delete(memberships).where(eq(memberships.id, membershipId));
  });
}

export async function changeMembershipRole(membershipId: string, newRole: Role, tx?: Tx): Promise<void> {
  await runInTx(tx, async (t) => {
    const membership = await getMembershipOrThrow(membershipId, t);
    if (membership.role === "owner" && newRole !== "owner") {
      await assertNotLastOwner(membershipId, t);
    }
    await t.update(memberships).set({ role: newRole }).where(eq(memberships.id, membershipId));
  });
}
