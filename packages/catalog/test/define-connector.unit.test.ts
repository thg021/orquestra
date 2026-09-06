import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineConnector } from "../src/define";
import { secret } from "../src/secret";

const validInput = {
  key: "fortes-conecta",
  title: "Fortes Conecta",
  capability: "document-delivery",
  kind: "native",
  authKind: "api_key",
  authSchema: z.object({
    baseUrl: z.url(),
    apiKey: secret(z.string().min(1))
  })
} as const;

describe("defineConnector", () => {
  it("devolve a definição com o que ela entrega e como autentica", () => {
    const connector = defineConnector(validInput);

    expect(connector.key).toBe("fortes-conecta");
    expect(connector.capability).toBe("document-delivery");
    expect(connector.kind).toBe("native");
    expect(connector.authKind).toBe("api_key");
  });

  it("recusa capability que não existe no contrato", () => {
    expect(() =>
      defineConnector({ ...validInput, capability: "telepatia" as never })
    ).toThrowError(/telepatia/);
  });

  it("recusa tipo de adapter desconhecido", () => {
    expect(() => defineConnector({ ...validInput, kind: "carteiro" as never })).toThrowError(
      /carteiro/
    );
  });

  it("recusa chave fora do formato slug", () => {
    expect(() => defineConnector({ ...validInput, key: "Fortes Conecta" })).toThrowError(
      /Fortes Conecta/
    );
  });

  it("recusa conector que não marca nenhum campo como secreto", () => {
    expect(() =>
      defineConnector({
        ...validInput,
        authSchema: z.object({ baseUrl: z.url(), apiKey: z.string() })
      })
    ).toThrowError(/secret/i);
  });

  it("expõe quais campos vão para o cofre e quais ficam legíveis", () => {
    const connector = defineConnector(validInput);

    expect(connector.secretFields).toEqual(["apiKey"]);
    expect(connector.metadataFields).toEqual(["baseUrl"]);
  });
});
