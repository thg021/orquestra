import { describe, it, expect } from "vitest";
import { computeNextRunAt, InvalidCronExpressionError } from "../../src/scheduling/cron";

describe("computeNextRunAt", () => {
  it("calcula a próxima ocorrência a partir de `from`, no fuso dado", () => {
    // "0 9 2 * *" = dia 2 do mês, 9h. `from` é dia 1 às 10h — a próxima é já amanhã.
    const from = new Date("2026-03-01T13:00:00.000Z"); // 10h em America/Sao_Paulo (UTC-3)
    const next = computeNextRunAt("0 9 2 * *", "America/Sao_Paulo", from);

    expect(next.toISOString()).toBe("2026-03-02T12:00:00.000Z"); // 9h em America/Sao_Paulo
  });

  it("a próxima ocorrência parte sempre de `from`, nunca da janela perdida — mesmo horas depois", () => {
    // Perder a janela das 9h do dia 2 e só rodar de novo às 20h do dia 2 não deve
    // produzir uma ocorrência "atrasada" para hoje — a próxima é o mês que vem.
    const missedFrom = new Date("2026-03-02T23:00:00.000Z"); // 20h em America/Sao_Paulo
    const next = computeNextRunAt("0 9 2 * *", "America/Sao_Paulo", missedFrom);

    expect(next.toISOString()).toBe("2026-04-02T12:00:00.000Z");
  });

  it("expressão inválida lança InvalidCronExpressionError, nomeando a expressão", () => {
    expect(() => computeNextRunAt("não é cron", "America/Sao_Paulo", new Date())).toThrowError(
      InvalidCronExpressionError
    );
  });

  it("fuso horário inválido também é recusado, em vez de calcular hora errada", () => {
    expect(() => computeNextRunAt("0 9 2 * *", "Nao/Existe", new Date())).toThrowError(InvalidCronExpressionError);
  });
});
