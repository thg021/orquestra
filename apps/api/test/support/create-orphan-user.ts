import { withoutTenant, identitySchema } from "@orquestra/db";
import { newId } from "@orquestra/core";

const { users } = identitySchema;

/**
 * Insere um usuário sem tenant nem membership — cenário que createTenantWithOwner
 * nunca produz sozinho, mas que login()/me() precisam recusar corretamente (AUTH-07).
 * Existe só para o teste, por isso vive em test/support e não em src/.
 */
export async function createUserWithoutMembershipForTest(
  email: string,
  passwordHash: string
): Promise<string> {
  const userId = newId();
  await withoutTenant(async (tx) => {
    await tx.insert(users).values({ id: userId, email, passwordHash });
  });
  return userId;
}
