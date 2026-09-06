export const API_BASE_URL = "/api";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | undefined;

/** Chamado pelo main.tsx com router.navigate("/login") — client.ts não conhece o router. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined): void {
  unauthorizedHandler = handler;
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** login() usa isto: um 401 de credencial errada não deve navegar pra /login. */
  skipUnauthorizedHandling?: boolean;
}

interface ErrorPayload {
  code?: string;
  message?: string;
}

/**
 * `credentials: "include"` em toda chamada — é o que leva o cookie de sessão.
 * Erro de rede (fetch rejeita) nunca é tratado como 401: só resposta HTTP real com
 * status 401 dispara o handler de sessão expirada.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, skipUnauthorizedHandling, headers, ...rest } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && !skipUnauthorizedHandling) {
    unauthorizedHandler?.();
  }

  const contentType = response.headers.get("content-type");
  const payload: unknown = contentType?.includes("application/json")
    ? await response.json().catch(() => undefined)
    : undefined;

  if (!response.ok) {
    const errorPayload = payload as ErrorPayload | undefined;
    throw new ApiError(
      response.status,
      errorPayload?.code ?? "UNKNOWN_ERROR",
      errorPayload?.message ?? "Não foi possível processar a requisição."
    );
  }

  return payload as T;
}
