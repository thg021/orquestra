import { describe, it, expect } from "vitest";
import { checkFormSchemaSupport } from "../../src/json-schema";
import { platformUpload } from "../../src/connectors/platform-upload";
import { onedrive } from "../../src/connectors/onedrive";
import { googleDrive } from "../../src/connectors/google-drive";
import { gmail } from "../../src/connectors/gmail";
import { whatsapp } from "../../src/connectors/whatsapp";
import { fortesConecta } from "../../src/connectors/fortes-conecta";

const ALL = [
  { name: "platform-upload", def: platformUpload, capability: "file-storage", kind: "native", authKind: "api_key" },
  { name: "onedrive", def: onedrive, capability: "file-storage", kind: "native", authKind: "oauth" },
  { name: "google-drive", def: googleDrive, capability: "file-storage", kind: "mcp", authKind: "oauth" },
  { name: "gmail", def: gmail, capability: "email", kind: "native", authKind: "oauth" },
  { name: "whatsapp", def: whatsapp, capability: "messaging", kind: "mcp", authKind: "api_key" },
  {
    name: "fortes-conecta",
    def: fortesConecta,
    capability: "document-delivery",
    kind: "native",
    authKind: "api_key"
  }
] as const;

describe.each(ALL)("$name", ({ def, capability, kind, authKind }) => {
  it(`satisfaz a capability ${capability}`, () => {
    expect(def.capability).toBe(capability);
  });

  it(`é do tipo ${kind}`, () => {
    expect(def.kind).toBe(kind);
  });

  it(`autentica por ${authKind}`, () => {
    expect(def.authKind).toBe(authKind);
  });

  it("declara ao menos um campo secreto", () => {
    expect(def.secretFields.length).toBeGreaterThan(0);
  });

  it("o auth_schema cabe no subconjunto que o formulário sabe desenhar", () => {
    expect(checkFormSchemaSupport(def.authSchema)).toEqual({ supported: true });
  });
});

describe("conector OAuth sem fluxo ainda (M1)", () => {
  it("onedrive aceita um refresh token colado à mão, como ponte até o M3", () => {
    const parsed = onedrive.authSchema.safeParse({ refreshToken: "1//token-de-teste" });
    expect(parsed.success).toBe(true);
  });
});

describe("conector com credencial fixa (M1)", () => {
  it("fortes-conecta exige URL base e chave de API", () => {
    const parsed = fortesConecta.authSchema.safeParse({
      baseUrl: "https://conecta.fortestecnologia.com.br",
      apiKey: "chave-de-teste"
    });
    expect(parsed.success).toBe(true);
  });
});
