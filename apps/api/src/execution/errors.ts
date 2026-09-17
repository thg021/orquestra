import { DomainError } from "@orquestra/core";

export class ServiceRunNotFoundError extends DomainError {
  constructor(id: string) {
    super("SERVICE_RUN_NOT_FOUND", `Execução "${id}" não encontrada.`);
  }
}

/** Também usado quando o pedido é de outro tenant — RLS faz a linha "sumir" antes daqui, então o erro é indistinguível de "não existe" (T13). */
export class ApprovalRequestNotFoundError extends DomainError {
  constructor(id: string) {
    super("APPROVAL_REQUEST_NOT_FOUND", `Pedido de aprovação "${id}" não encontrado.`);
  }
}

/** Traduz o `AlreadyDecidedError` (puro, de `@orquestra/db`) para o mecanismo de erro de domínio da API (APR-05). */
export class ApprovalAlreadyDecidedError extends DomainError {
  constructor(id: string) {
    super("APPROVAL_ALREADY_DECIDED", `Pedido de aprovação "${id}" já foi decidido.`);
  }
}
