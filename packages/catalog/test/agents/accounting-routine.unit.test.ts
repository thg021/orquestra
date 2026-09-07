import { describe, it, expect } from "vitest";
import { accountingRoutine } from "../../src/agents/accounting-routine";
import { checkFormSchemaSupport } from "../../src/json-schema";

describe("accountingRoutine", () => {
  it("é a rotina contábil, versão 1.0.0", () => {
    expect(accountingRoutine.key).toBe("accounting-routine");
    expect(accountingRoutine.version).toBe("1.0.0");
    expect(accountingRoutine.ref).toBe("accounting-routine@1.0.0");
  });

  it("exige file-storage e email como obrigatórias, document-delivery e messaging como opcionais", () => {
    expect([...accountingRoutine.requiredCapabilities].sort()).toEqual(["email", "file-storage"]);
    expect([...accountingRoutine.optionalCapabilities].sort()).toEqual([
      "document-delivery",
      "messaging"
    ]);
  });

  it("a configuração cabe no subconjunto que o formulário do painel sabe desenhar", () => {
    const result = checkFormSchemaSupport(accountingRoutine.configSchema);
    expect(result).toEqual({ supported: true });
  });

  it("a configuração aceita assinatura, prazo padrão e cópia padrão de e-mail", () => {
    const parsed = accountingRoutine.configSchema.safeParse({
      signature: "Escritório Silva Contabilidade",
      defaultDeadline: "todo dia 20",
      defaultCc: ["socia@silvacontabilidade.com.br"]
    });

    expect(parsed.success).toBe(true);
  });

  it("recusa configuração sem assinatura", () => {
    const parsed = accountingRoutine.configSchema.safeParse({
      defaultDeadline: "todo dia 20",
      defaultCc: []
    });

    expect(parsed.success).toBe(false);
  });

  it("declara a coleção customers, que substitui o clientes.yaml", () => {
    expect(accountingRoutine.dataCollections.map((c) => c.key)).toEqual(["customers"]);
  });

  it("a coleção customers aceita um cliente com contatos multicanal", () => {
    const customers = accountingRoutine.dataCollections.find((c) => c.key === "customers");
    // O canal de contato reaproveita o vocabulário de capability de saída (design §4:
    // "a escolha entre elas é por destinatário") — não inventa um enum próprio.
    const parsed = customers?.schema.safeParse({
      name: "Padaria Silva",
      categories: ["commerce", "hasEmployees"],
      contacts: [
        { channel: "email", value: "financeiro@padariasilva.com.br" },
        { channel: "messaging", value: "+5511999990000" }
      ]
    });

    expect(parsed?.success).toBe(true);
  });

  it("a coleção customers recusa canal de contato que não é uma capability de saída", () => {
    const customers = accountingRoutine.dataCollections.find((c) => c.key === "customers");
    const parsed = customers?.schema.safeParse({
      name: "Padaria Silva",
      categories: ["commerce"],
      contacts: [{ channel: "file-storage", value: "..." }]
    });

    expect(parsed?.success).toBe(false);
  });
});
