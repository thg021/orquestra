import { describe, it, expect } from "vitest";
import { z } from "zod";
import { secret, isSecret } from "../src/secret";

describe("secret", () => {
  it("marca o campo sem mudar o que ele valida", () => {
    const field = secret(z.string().min(3));

    expect(field.safeParse("abc").success).toBe(true);
    expect(field.safeParse("ab").success).toBe(false);
  });

  it("é reconhecível pelo próprio marcador", () => {
    expect(isSecret(secret(z.string()))).toBe(true);
    expect(isSecret(z.string())).toBe(false);
  });

  it("sobrevive à conversão para JSON Schema, que é o que o painel lê", () => {
    const schema = z.object({
      baseUrl: z.url(),
      apiKey: secret(z.string())
    });

    const jsonSchema = z.toJSONSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(jsonSchema.properties.apiKey?.secret).toBe(true);
    expect(jsonSchema.properties.baseUrl?.secret).toBeUndefined();
  });
});
