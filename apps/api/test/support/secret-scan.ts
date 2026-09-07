/**
 * Varre por VALOR, não por nome de campo (T23) — um DTO novo com nome inocente
 * ainda seria pego, porque o que importa é se o texto do sentinela aparece em
 * algum lugar da estrutura, não onde.
 */
export function containsSentinel(value: unknown, sentinel: string): boolean {
  if (typeof value === "string") {
    return value.includes(sentinel);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSentinel(item, sentinel));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsSentinel(item, sentinel));
  }
  return false;
}

export class SentinelLeakError extends Error {
  constructor(label: string) {
    super(`Vazamento de segredo detectado em: ${label}`);
    this.name = "SentinelLeakError";
  }
}

export function assertNoSentinelLeak(candidates: readonly { label: string; value: unknown }[], sentinel: string): void {
  for (const candidate of candidates) {
    if (containsSentinel(candidate.value, sentinel)) {
      throw new SentinelLeakError(candidate.label);
    }
  }
}
