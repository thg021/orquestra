import { DomainError } from "@orquestra/core";

export class AgentNotFoundError extends DomainError {
  constructor(agentKey: string) {
    super("AGENT_NOT_FOUND", `Agente "${agentKey}" não existe no catálogo.`);
  }
}

/** Instância presa a uma versão que saiu do catálogo — continua legível, não editável. */
export class AgentVersionMissingError extends DomainError {
  constructor(agentKey: string, agentVersion: string) {
    super(
      "AGENT_VERSION_MISSING",
      `A versão "${agentVersion}" do agente "${agentKey}" não está mais disponível no catálogo.`
    );
  }
}

export class ServiceInstanceNotFoundError extends DomainError {
  constructor(id: string) {
    super("SERVICE_INSTANCE_NOT_FOUND", `Instância "${id}" não encontrada.`);
  }
}
