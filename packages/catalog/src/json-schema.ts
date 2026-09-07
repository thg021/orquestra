import { z } from "zod";

/**
 * Converte um schema Zod para o JSON Schema que o painel consome pra montar o
 * formulário. `z.toJSONSchema` é nativo do Zod 4 — dispensa `zod-to-json-schema` — e
 * carrega o `.meta()` de cada campo, incluindo a marca `secret` de `secret()`.
 */
export function toFormSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { unrepresentable: "any" });
}

export type FormSchemaSupport =
  | { supported: true }
  | { supported: false; unsupportedPaths: readonly string[] };

interface JsonSchemaNode {
  type?: string | string[];
  enum?: readonly unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
}

/**
 * O painel só sabe renderizar um subconjunto de JSON Schema: texto (com ou sem enum),
 * número, booleano, lista de texto, e objeto de UM nível (sem aninhar objeto dentro de
 * objeto). Qualquer schema fora disso precisa ser pego na subida — não no navegador do
 * escritório, tentando desenhar um campo que não existe.
 */
export function checkFormSchemaSupport(schema: z.ZodType): FormSchemaSupport {
  const jsonSchema = toFormSchema(schema) as JsonSchemaNode;
  const unsupportedPaths: string[] = [];

  function walk(node: JsonSchemaNode, path: string, depth: number): void {
    if (node.type === "object") {
      if (depth > 0) {
        unsupportedPaths.push(path);
        return;
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        walk(child, path === "" ? key : `${path}.${key}`, depth + 1);
      }
      return;
    }

    if (node.type === "array") {
      if (node.items?.type !== "string") {
        unsupportedPaths.push(path);
      }
      return;
    }

    const supportedLeaf =
      node.type === "string" ||
      node.type === "number" ||
      node.type === "integer" ||
      node.type === "boolean";
    if (!supportedLeaf) {
      unsupportedPaths.push(path);
    }
  }

  walk(jsonSchema, "", 0);

  if (unsupportedPaths.length === 0) return { supported: true };
  return { supported: false, unsupportedPaths };
}
