import { describe, it, expect } from "vitest";
import { evaluateActivation, type EvaluateActivationInput } from "../src/activation-gate";

function baseInput(overrides: Partial<EvaluateActivationInput> = {}): EvaluateActivationInput {
  return {
    agentVersionExists: true,
    configValid: true,
    capabilities: [
      { capability: "file-storage", required: true, connectionId: "conn-1", connectionStatus: "active" },
      { capability: "email", required: true, connectionId: "conn-2", connectionStatus: "active" },
      { capability: "messaging", required: false, connectionId: undefined, connectionStatus: undefined }
    ],
    ...overrides
  };
}

describe("evaluateActivation", () => {
  it("caminho feliz: obrigatórias ligadas e ativas, opcional vazia — ativa", () => {
    const result = evaluateActivation(baseInput());
    expect(result).toEqual({ ok: true });
  });

  it("capability obrigatória sem vínculo recusa, nomeando qual falta", () => {
    const result = evaluateActivation(
      baseInput({
        capabilities: [
          { capability: "file-storage", required: true, connectionId: undefined, connectionStatus: undefined },
          { capability: "email", required: true, connectionId: "conn-2", connectionStatus: "active" }
        ]
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("deveria ter recusado");
    expect(result.impediments).toContainEqual({ code: "CAPABILITY_UNBOUND", capabilities: ["file-storage"] });
  });

  it("capability opcional sem vínculo NÃO impede a ativação", () => {
    const result = evaluateActivation(
      baseInput({
        capabilities: [
          { capability: "file-storage", required: true, connectionId: "conn-1", connectionStatus: "active" },
          { capability: "email", required: true, connectionId: "conn-2", connectionStatus: "active" },
          { capability: "messaging", required: false, connectionId: undefined, connectionStatus: undefined },
          { capability: "document-delivery", required: false, connectionId: undefined, connectionStatus: undefined }
        ]
      })
    );

    expect(result).toEqual({ ok: true });
  });

  it("config inválida recusa, carregando os campos com problema", () => {
    const result = evaluateActivation(
      baseInput({ configValid: false, invalidConfigFields: ["signature", "defaultDeadline"] })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("deveria ter recusado");
    expect(result.impediments).toContainEqual({
      code: "CONFIG_INVALID",
      fields: ["signature", "defaultDeadline"]
    });
  });

  it("conexão vinculada revogada recusa, nomeando a capability afetada", () => {
    const result = evaluateActivation(
      baseInput({
        capabilities: [
          { capability: "file-storage", required: true, connectionId: "conn-1", connectionStatus: "revoked" },
          { capability: "email", required: true, connectionId: "conn-2", connectionStatus: "active" }
        ]
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("deveria ter recusado");
    expect(result.impediments).toContainEqual({ code: "CONNECTION_REVOKED", capabilities: ["file-storage"] });
  });

  it("versão do agente ausente recusa sozinha, sem checar mais nada", () => {
    const result = evaluateActivation({
      agentVersionExists: false,
      configValid: false,
      capabilities: []
    });

    expect(result).toEqual({ ok: false, impediments: [{ code: "AGENT_VERSION_MISSING" }] });
  });

  it("acumula mais de um impedimento na mesma avaliação", () => {
    const result = evaluateActivation(
      baseInput({
        configValid: false,
        invalidConfigFields: ["signature"],
        capabilities: [
          { capability: "file-storage", required: true, connectionId: undefined, connectionStatus: undefined },
          { capability: "email", required: true, connectionId: "conn-2", connectionStatus: "revoked" }
        ]
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("deveria ter recusado");
    expect(result.impediments).toHaveLength(3);
    expect(result.impediments).toContainEqual({ code: "CONFIG_INVALID", fields: ["signature"] });
    expect(result.impediments).toContainEqual({ code: "CAPABILITY_UNBOUND", capabilities: ["file-storage"] });
    expect(result.impediments).toContainEqual({ code: "CONNECTION_REVOKED", capabilities: ["email"] });
  });

  it("não faz I/O: função síncrona e pura, chamável sem qualquer setup", () => {
    expect(evaluateActivation(baseInput()).ok).toBe(true);
  });
});
