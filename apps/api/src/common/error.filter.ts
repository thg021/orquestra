import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { DomainError } from "@orquestra/core";

export interface FieldError {
  path: string;
  message: string;
}

interface ErrorBody {
  code: string;
  message: string;
  fields?: FieldError[];
}

const DOMAIN_ERROR_STATUS: Record<string, number> = {
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  NO_MEMBERSHIP: HttpStatus.FORBIDDEN,
  INSUFFICIENT_ROLE: HttpStatus.FORBIDDEN,
  LAST_OWNER_PROTECTED: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  TENANT_NAME_DUPLICATE: HttpStatus.CONFLICT,
  PASSWORD_TOO_WEAK: HttpStatus.BAD_REQUEST,
  AGENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  AGENT_VERSION_MISSING: HttpStatus.CONFLICT,
  SERVICE_INSTANCE_NOT_FOUND: HttpStatus.NOT_FOUND
};

// Texto de interface, deliberadamente diferente de DomainError.message (que é
// descrição técnica para log) — nunca ecoa detalhe interno (T7).
const DOMAIN_ERROR_MESSAGE: Record<string, string> = {
  INVALID_CREDENTIALS: "E-mail ou senha inválidos.",
  NO_MEMBERSHIP: "Sua conta não está vinculada a nenhuma organização.",
  INSUFFICIENT_ROLE: "Você não tem permissão para esta ação.",
  LAST_OWNER_PROTECTED: "Não é possível remover ou rebaixar o último owner do tenant.",
  RATE_LIMITED: "Muitas tentativas. Tente novamente em instantes.",
  TENANT_NAME_DUPLICATE: "Já existe um tenant com esse nome.",
  PASSWORD_TOO_WEAK: "Senha muito curta.",
  AGENT_NOT_FOUND: "Agente não encontrado no catálogo.",
  AGENT_VERSION_MISSING: "Esta instância usa uma versão do agente que não está mais disponível.",
  SERVICE_INSTANCE_NOT_FOUND: "Serviço não encontrado."
};

const DEFAULT_MESSAGE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "Requisição inválida.",
  [HttpStatus.UNAUTHORIZED]: "Não autenticado.",
  [HttpStatus.FORBIDDEN]: "Acesso negado.",
  [HttpStatus.NOT_FOUND]: "Recurso não encontrado.",
  [HttpStatus.TOO_MANY_REQUESTS]: "Muitas tentativas. Tente novamente em instantes."
};

const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED"
};

function extractPayloadField(payload: unknown, field: string): string | undefined {
  if (typeof payload === "object" && payload !== null && field in payload) {
    const value = (payload as Record<string, unknown>)[field];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/**
 * Só repassa `fields` — nunca o payload inteiro sem filtro, pra não vazar alguma
 * outra chave que uma exceção decida carregar no futuro sem essa revisão em mente.
 */
function extractFieldErrors(payload: unknown): FieldError[] | undefined {
  if (typeof payload !== "object" || payload === null || !("fields" in payload)) return undefined;
  const fields = (payload as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return undefined;
  return fields.filter(
    (item): item is FieldError =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as FieldError).path === "string" &&
      typeof (item as FieldError).message === "string"
  );
}

/**
 * Único ponto de tradução de erro → resposta HTTP. Nunca deixa passar mensagem crua de
 * exceção não mapeada — erro inesperado vira sempre o mesmo envelope genérico, com o
 * detalhe real só no log do servidor (nunca hash, SQL, string de conexão ou token).
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("ErrorFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = DOMAIN_ERROR_STATUS[exception.code] ?? HttpStatus.BAD_REQUEST;
      const message = DOMAIN_ERROR_MESSAGE[exception.code] ?? "Não foi possível concluir a operação.";
      const body: ErrorBody = { code: exception.code, message };
      response.status(status).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const code = extractPayloadField(payload, "code") ?? DEFAULT_CODE_BY_STATUS[status] ?? "ERROR";
      const message =
        extractPayloadField(payload, "message") ??
        DEFAULT_MESSAGE_BY_STATUS[status] ??
        "Não foi possível processar a requisição.";
      const fields = extractFieldErrors(payload);
      const body: ErrorBody = fields ? { code, message, fields } : { code, message };
      response.status(status).json(body);
      return;
    }

    this.logger.error(
      "Erro não tratado",
      exception instanceof Error ? exception.stack : String(exception)
    );
    const body: ErrorBody = { code: "INTERNAL_ERROR", message: "Erro interno do servidor." };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
