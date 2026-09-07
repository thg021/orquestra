import { describe, it, expect } from "vitest";
import { containsSentinel, assertNoSentinelLeak, SentinelLeakError } from "./secret-scan";

const SENTINEL = "SENTINELA-XYZ";

describe("containsSentinel", () => {
  it("acha o sentinela dentro de um objeto aninhado, não importa o nome do campo", () => {
    expect(containsSentinel({ umCampoInocente: { outro: [SENTINEL] } }, SENTINEL)).toBe(true);
  });

  it("não acha quando o valor não contém o sentinela", () => {
    expect(containsSentinel({ nome: "Ana", detalhes: { x: "y" } }, SENTINEL)).toBe(false);
  });
});

describe("assertNoSentinelLeak", () => {
  it("morde: se um endpoint 'adulterado' devolvesse o segredo, a asserção falha", () => {
    const candidates = [
      { label: "resposta de /connections (adulterada)", value: { apiKey: `chave-${SENTINEL}-fim` } }
    ];

    expect(() => assertNoSentinelLeak(candidates, SENTINEL)).toThrow(SentinelLeakError);
  });

  it("não falha quando nenhum candidato carrega o segredo", () => {
    const candidates = [{ label: "resposta limpa", value: { last4: "9999" } }];
    expect(() => assertNoSentinelLeak(candidates, SENTINEL)).not.toThrow();
  });
});
