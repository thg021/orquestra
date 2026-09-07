import { CronExpressionParser } from "cron-parser";
import { DomainError } from "../errors";

export class InvalidCronExpressionError extends DomainError {
  constructor(expression: string) {
    super("INVALID_CRON_EXPRESSION", `Expressão de recorrência inválida: "${expression}".`);
  }
}

/**
 * A próxima ocorrência, calculada a partir de `from` — nunca da última janela
 * perdida (design §Decisões técnicas). É o que evita rajada de disparos quando o
 * scheduler volta depois de horas fora do ar (SCH-04).
 */
export function computeNextRunAt(cron: string, timezone: string, from: Date): Date {
  try {
    const interval = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
    return interval.next().toDate();
  } catch {
    throw new InvalidCronExpressionError(cron);
  }
}
