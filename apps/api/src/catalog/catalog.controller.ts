import { Controller, Get } from "@nestjs/common";
import { AGENTS, CONNECTORS, toFormSchema } from "@orquestra/catalog";
import type { AgentSummary, ConnectorSummary } from "@orquestra/contracts";

/**
 * Sem dependência injetada de propósito: o catálogo vem do código, não do banco
 * (CAT-05) — não há repositório nem serviço para pedir emprestado aqui.
 */
@Controller("catalog")
export class CatalogController {
  @Get("agents")
  agents(): AgentSummary[] {
    return AGENTS.map(
      (agent): AgentSummary => ({
        key: agent.key,
        version: agent.version,
        title: agent.title,
        description: agent.description,
        capabilities: [...agent.capabilities],
        configSchema: toFormSchema(agent.configSchema)
      })
    );
  }

  @Get("connectors")
  connectors(): ConnectorSummary[] {
    return CONNECTORS.map(
      (connector): ConnectorSummary => ({
        key: connector.key,
        title: connector.title,
        capability: connector.capability,
        kind: connector.kind,
        authKind: connector.authKind,
        authSchema: toFormSchema(connector.authSchema)
      })
    );
  }
}
