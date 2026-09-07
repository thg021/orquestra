import { DomainError } from "@orquestra/core";

export class ConnectorNotFoundError extends DomainError {
  constructor(connectorKey: string) {
    super("CONNECTOR_NOT_FOUND", `Conector "${connectorKey}" não existe no catálogo.`);
  }
}

/** Casa o índice único da tabela (tenant, connector_key, name) — checado antes da cifragem. */
export class ConnectionNameDuplicateError extends DomainError {
  constructor() {
    super("CONNECTION_NAME_DUPLICATE", "Já existe uma conexão com esse nome para este conector.");
  }
}
