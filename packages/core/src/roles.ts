export const ROLES = ["owner", "admin", "operator"] as const;

export type Role = (typeof ROLES)[number];

// operator é o mínimo necessário para decidir um ApprovalRequest (M2).
const PRECEDENCE: Record<Role, number> = {
  owner: 3,
  admin: 2,
  operator: 1
};

/** Verdadeiro se `role` tem precedência igual ou maior que `required`. */
export function hasAtLeast(role: Role, required: Role): boolean {
  return PRECEDENCE[role] >= PRECEDENCE[required];
}
