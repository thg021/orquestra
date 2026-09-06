import { z } from "zod";

// Duplicado deliberadamente do enum de packages/core: contracts não depende de core
// para não puxar dependências nativas (argon2) para o bundle do painel.
export const roleSchema = z.enum(["owner", "admin", "operator"]);
export type RoleContract = z.infer<typeof roleSchema>;

// Trim antes de validar o formato: espaço no fim de um e-mail colado é erro do dedo,
// não intenção. O pipe garante a ordem — normaliza primeiro, valida depois.
const emailField = z.string().trim().min(1, "E-mail é obrigatório").pipe(z.email("E-mail inválido"));

export const loginRequestSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Senha é obrigatória")
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

const authContextSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email()
  }),
  tenant: z.object({
    id: z.uuid(),
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
