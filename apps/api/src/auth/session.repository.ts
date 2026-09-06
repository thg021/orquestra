import { randomBytes, createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { withoutTenant, identitySchema, type Tx } from "@orquestra/db";
import { newId } from "@orquestra/core";

const { sessions } = identitySchema;

const TOKEN_BYTES = 32; // 256 bits

export interface CreatedSession {
  /** Valor cru do token — devolvido só aqui, uma única vez. Nunca persistido. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

async function runInTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : withoutTenant(fn);
}

export async function createSession(
  input: { userId: string; tenantId: string; ttlMs: number },
  tx?: Tx
): Promise<CreatedSession> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const sessionId = newId();
  const expiresAt = new Date(Date.now() + input.ttlMs);

  await runInTx(tx, async (t) => {
    await t.insert(sessions).values({
      id: sessionId,
      userId: input.userId,
      tenantId: input.tenantId,
      tokenHash: hashToken(token),
      expiresAt
    });
  });

  return { token, sessionId, expiresAt };
}

/**
 * Devolve undefined para token ausente, malformado, inexistente ou expirado — nunca
 * lança. O chamador (guard) trata todos esses casos de forma idêntica (401 uniforme).
 */
export async function resolveSession(rawToken: string, tx?: Tx): Promise<ResolvedSession | undefined> {
  if (!rawToken) {
    return undefined;
  }

  return runInTx(tx, async (t) => {
    const rows = await t
      .select({
        id: sessions.id,
        userId: sessions.userId,
        tenantId: sessions.tenantId,
        expiresAt: sessions.expiresAt
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(rawToken)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return undefined;
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      return undefined;
    }

    await t.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, row.id));

    return { sessionId: row.id, userId: row.userId, tenantId: row.tenantId, expiresAt: row.expiresAt };
  });
}

/** DELETE na linha — o cookie capturado deixa de valer imediatamente (AUTH-05). */
export async function revokeSession(sessionId: string, tx?: Tx): Promise<void> {
  await runInTx(tx, async (t) => {
    await t.delete(sessions).where(eq(sessions.id, sessionId));
  });
}

/** Limpeza de manutenção — não é chamado no caminho de autenticação. */
export async function deleteExpiredSessions(tx?: Tx): Promise<number> {
  return runInTx(tx, async (t) => {
    const deleted = await t.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({
      id: sessions.id
    });
    return deleted.length;
  });
}
