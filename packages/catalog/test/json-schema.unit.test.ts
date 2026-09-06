import { describe, it, expect } from "vitest";
import { z } from "zod";
import { secret } from "../src/secret";
import { toFormSchema, checkFormSchemaSupport } from "../src/json-schema";

describe("checkFormSchemaSupport", () => {
  it("aceita o subconjunto suportado: texto, enum, número, booleano, lista de texto, objeto de um nível", () => {
    const schema = z.object({
      nome: z.string(),
      status: z.enum(["ativo", "pausado"]),
      dias: z.number().int(),
      habilitado: z.boolean(),
      emails: z.array(z.string())
    });

    expect(checkFormSchemaSupport(schema)).toEqual({ supported: true });
  });

  it("recusa construto fora do subconjunto, nomeando o caminho do campo", () => {
    const schema = z.object({ mapa: z.map(z.string(), z.string()) });

    const result = checkFormSchemaSupport(schema);

    expect(result.supported).toBe(false);
    expect(result.supported === false && result.unsupportedPaths).toContain("mapa");
  });

  it("recusa objeto de dois níveis (aninhamento)", () => {
    const schema = z.object({ endereco: z.object({ rua: z.string() }) });

    const result = checkFormSchemaSupport(schema);

    expect(result.supported).toBe(false);
    expect(result.supported === false && result.unsupportedPaths).toContain("endereco");
  });

  it("recusa lista de algo que não é texto", () => {
    const schema = z.object({ numeros: z.array(z.number()) });

    const result = checkFormSchemaSupport(schema);

    expect(result.supported).toBe(false);
  });
});

describe("toFormSchema", () => {
  it("converte para JSON Schema preservando a marca de campo secreto", () => {
    const schema = z.object({
      baseUrl: z.url(),
      apiKey: secret(z.string())
    });

    const jsonSchema = toFormSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(jsonSchema.properties.baseUrl?.type).toBe("string");
    expect(jsonSchema.properties.apiKey?.secret).toBe(true);
    expect(jsonSchema.properties.baseUrl?.secret).toBeUndefined();
  });
});
