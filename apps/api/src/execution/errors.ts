import { DomainError } from "@orquestra/core";

export class ServiceRunNotFoundError extends DomainError {
  constructor(id: string) {
    super("SERVICE_RUN_NOT_FOUND", `Execução "${id}" não encontrada.`);
  }
}
