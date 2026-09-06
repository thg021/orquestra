import { verifyPassword, hashPassword, InvalidCredentialsError, NoMembershipError, type Role } from "@orquestra/core";
import { findUserByEmail, findUserById, findActiveMembership, normalizeEmail } from "../identity/identity.repository";
import { createSession, revokeSession } from "./session.repository";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — sem seletor de tenant, reautenticar não é fricção grande

let decoyHashPromise: Promise<string> | undefined;

/** Hash real e verificável, computado uma vez, para igualar o tempo do caminho de e-mail inexistente. */
function getDecoyHash(): Promise<string> {
  decoyHashPromise ??= hashPassword("senha-descartavel-nunca-usada-para-autenticar-de-verdade");
  return decoyHashPromise;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  userId: string;
  userEmail: string;
  tenantId: string;
  tenantName: string;
  role: Role;
}

export interface MeResult {
  userId: string;
  userEmail: string;
  tenantId: string;
  tenantName: string;
  role: Role;
}

/**
 * E-mail inexistente e senha errada terminam no mesmo InvalidCredentialsError, com o
 * mesmo custo de verificação — a resposta não revela se o e-mail existe (AUTH-02).
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await findUserByEmail(normalizeEmail(email));

  if (!user) {
    await verifyPassword(password, await getDecoyHash());
    throw new InvalidCredentialsError();
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    throw new InvalidCredentialsError();
  }

  // AUTH-07: usuário sem vínculo não recebe sessão, mesmo com credencial correta.
  const membership = await findActiveMembership(user.id);
  if (!membership) {
    throw new NoMembershipError();
  }

  const session = await createSession({
    userId: user.id,
    tenantId: membership.tenantId,
    ttlMs: SESSION_TTL_MS
  });

  return {
    token: session.token,
    expiresAt: session.expiresAt,
    userId: user.id,
    userEmail: user.email,
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    role: membership.role
  };
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
}

export async function me(userId: string): Promise<MeResult> {
  const [user, membership] = await Promise.all([findUserById(userId), findActiveMembership(userId)]);
  if (!user || !membership) {
    throw new NoMembershipError();
  }
  return {
    userId: user.id,
    userEmail: user.email,
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    role: membership.role
  };
}
