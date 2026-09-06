import { RateLimitedError } from "@orquestra/core";

export interface ThrottleOptions {
  /** Tentativas malsucedidas permitidas dentro da janela antes de bloquear. */
  maxAttempts: number;
  /** Duração da janela deslizante, em milissegundos. */
  windowMs: number;
}

const DEFAULT_OPTIONS: ThrottleOptions = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000
};

interface AttemptRecord {
  count: number;
  windowStartedAt: number;
}

/**
 * Contador em memória do processo, com janela deslizante por chave (e-mail
 * normalizado). Suficiente enquanto há um único processo `api` no M0; a interface é a
 * mesma que um backend em Redis implementaria depois — trocar é substituir o adapter,
 * não o serviço de auth que o consome.
 */
export class AuthThrottle {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly options: ThrottleOptions;

  constructor(options: Partial<ThrottleOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Lança RateLimitedError se a chave está sob bloqueio temporário no momento. */
  check(key: string): void {
    const record = this.attempts.get(this.normalizeKey(key));
    if (!record || this.windowExpired(record)) {
      return;
    }
    if (record.count >= this.options.maxAttempts) {
      throw new RateLimitedError();
    }
  }

  /** Registra uma tentativa malsucedida, iniciando ou renovando a janela conforme o caso. */
  registerFailure(key: string): void {
    const normalized = this.normalizeKey(key);
    const now = Date.now();
    const existing = this.attempts.get(normalized);
    if (!existing || this.windowExpired(existing)) {
      this.attempts.set(normalized, { count: 1, windowStartedAt: now });
      return;
    }
    existing.count += 1;
  }

  /** Zera o contador da chave — chamado após autenticação bem-sucedida. */
  reset(key: string): void {
    this.attempts.delete(this.normalizeKey(key));
  }

  private windowExpired(record: AttemptRecord): boolean {
    return Date.now() - record.windowStartedAt >= this.options.windowMs;
  }

  // Normaliza aqui, além de na camada de auth.service — a chave é sempre o e-mail
  // normalizado, então variação de caixa nunca contorna o limite (RATE-01/RATE-03).
  private normalizeKey(key: string): string {
    return key.trim().toLowerCase();
  }
}
