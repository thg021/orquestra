import { z } from "zod";

// Duplicado deliberadamente do enum de packages/core: contracts não depende de core
// para não puxar dependências nativas (argon2) para o bundle do painel.
export const roleSchema = z.enum(["owner", "admin", "operator"]);
export type RoleContract = z.infer<typeof roleSchema>;

export const loginRequestSchema = z.object({
  email: z.string().trim().min(1, "E-mail é obrigatório").email("E-mail inválido"),
  password: z.string().min(1, "Senha é obrigatória")
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

const authContextSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email()
  }),
  tenant: z.object({
    id: z.string().uuid(),
    name: z.string()
  }),
  role: roleSchema
});

// Login devolve o mesmo formato de /auth/me: confirma a sessão criada sem repetir
// nenhum dado de credencial no corpo (o cookie é o único portador do token).
export const loginResponseSchema = authContextSchema;
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = authContextSchema;
export type MeResponse = z.infer<typeof meResponseSchema>;
