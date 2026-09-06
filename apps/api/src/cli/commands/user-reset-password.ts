import { hashPassword, assertPasswordPolicy, UserNotFoundError } from "@orquestra/core";
import { findUserByEmail, updateUserPassword } from "../../identity/identity.repository";

export interface UserResetPasswordArgs {
  email: string;
  password: string;
}

export async function runUserResetPassword(args: UserResetPasswordArgs): Promise<void> {
  assertPasswordPolicy(args.password);

  const user = await findUserByEmail(args.email);
  if (!user) {
    throw new UserNotFoundError(args.email);
  }

  const passwordHash = await hashPassword(args.password);
  await updateUserPassword(user.id, passwordHash);
}
