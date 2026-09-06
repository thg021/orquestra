import { DomainError } from "@orquestra/core";

/**
 * Definição de catálogo malformada. Lançado na própria chamada de defineAgent/
 * defineConnector — ou seja, no carregamento do módulo, que acontece na subida da
 * aplicação. Catálogo quebrado derruba o processo em vez de virar erro de runtime
 * na cara do usuário.
 */
export class InvalidDefinitionError extends DomainError {
  constructor(message: string) {
    super("CATALOG_DEFINITION_INVALID", message);
  }
}
