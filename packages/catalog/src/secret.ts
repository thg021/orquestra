import { z } from "zod";

/**
 * Marca um campo do `auth_schema` como segredo: é ele que vai cifrado para o cofre,
 * enquanto os campos sem marca ficam legíveis em `metadata` para o painel exibir.
 *
 * A marca é metadado do Zod (`.meta`), não convenção de nome de campo. Deduzir pelo
 * nome — "tudo que chama key ou token é segredo" — é onde esse tipo de erro nasce.
 * Marcado é explícito, verificável por teste, e atravessa a conversão para JSON Schema
 * intacto, então o painel sabe renderizar como senha sem regra duplicada no frontend.
 */
export function secret<T extends z.ZodType>(schema: T): T {
  return schema.meta({ secret: true }) as T;
}

/** Verdadeiro se o schema foi marcado por `secret()`. */
export function isSecret(schema: z.ZodType): boolean {
  return z.globalRegistry.get(schema)?.secret === true;
}
