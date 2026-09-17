import type { AgentDefinition, ConnectorDefinition } from "./define";
import { checkFormSchemaSupport } from "./json-schema";

const SLUG = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export type CatalogIssue =
  | { readonly code: "DUPLICATE_AGENT_KEY"; readonly key: string }
  | { readonly code: "DUPLICATE_CONNECTOR_KEY"; readonly key: string }
  | { readonly code: "INVALID_KEY"; readonly key: string }
  | { readonly code: "INVALID_VERSION"; readonly key: string; readonly version: string }
  | { readonly code: "CAPABILITY_ORPHANED"; readonly agentKey: string; readonly capability: string }
  | { readonly code: "UNSUPPORTED_FORM_SCHEMA"; readonly key: string; readonly paths: readonly string[] }
  | { readonly code: "AGENT_MISSING_GRAPH"; readonly key: string };

export interface CatalogInput {
  readonly agents: readonly AgentDefinition[];
  readonly connectors: readonly ConnectorDefinition[];
}

/**
 * Valida o catálogo inteiro — não uma definição isolada, que já é validada por
 * `defineAgent`/`defineConnector` na própria chamada. Aqui é onde aparece o problema
 * que só existe em relação às outras definições: chave repetida, capability que
 * nenhum conector satisfaz, schema fora do que o formulário do painel sabe desenhar.
 *
 * Revalida chave e versão de propósito, mesmo que `defineAgent` já as tenha checado:
 * o catálogo pode ser montado a partir de definições que não passaram por ele (ex.:
 * um cache serializado), e essa é a última linha de defesa antes da API subir.
 */
export function validateCatalog(input: CatalogInput): CatalogIssue[] {
  const issues: CatalogIssue[] = [];

  for (const agent of input.agents) {
    if (!SLUG.test(agent.key)) issues.push({ code: "INVALID_KEY", key: agent.key });
    if (!SEMVER.test(agent.version)) {
      issues.push({ code: "INVALID_VERSION", key: agent.key, version: agent.version });
    }

    const formCheck = checkFormSchemaSupport(agent.configSchema);
    if (!formCheck.supported) {
      issues.push({ code: "UNSUPPORTED_FORM_SCHEMA", key: agent.key, paths: formCheck.unsupportedPaths });
    }

    if (typeof agent.graph !== "function") {
      issues.push({ code: "AGENT_MISSING_GRAPH", key: agent.key });
    }
  }

  for (const connector of input.connectors) {
    if (!SLUG.test(connector.key)) issues.push({ code: "INVALID_KEY", key: connector.key });

    const formCheck = checkFormSchemaSupport(connector.authSchema);
    if (!formCheck.supported) {
      issues.push({ code: "UNSUPPORTED_FORM_SCHEMA", key: connector.key, paths: formCheck.unsupportedPaths });
    }
  }

  issues.push(...findDuplicateKeys(input.agents, "DUPLICATE_AGENT_KEY"));
  issues.push(...findDuplicateKeys(input.connectors, "DUPLICATE_CONNECTOR_KEY"));
  issues.push(...findOrphanedCapabilities(input));

  return issues;
}

function findDuplicateKeys(
  definitions: readonly { key: string }[],
  code: "DUPLICATE_AGENT_KEY" | "DUPLICATE_CONNECTOR_KEY"
): CatalogIssue[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const issues: CatalogIssue[] = [];

  for (const definition of definitions) {
    if (seen.has(definition.key) && !reported.has(definition.key)) {
      issues.push({ code, key: definition.key });
      reported.add(definition.key);
    }
    seen.add(definition.key);
  }

  return issues;
}

function findOrphanedCapabilities(input: CatalogInput): CatalogIssue[] {
  const satisfied = new Set(input.connectors.map((connector) => connector.capability));
  const issues: CatalogIssue[] = [];

  for (const agent of input.agents) {
    for (const capability of agent.requiredCapabilities) {
      if (!satisfied.has(capability)) {
        issues.push({ code: "CAPABILITY_ORPHANED", agentKey: agent.key, capability });
      }
    }
  }

  return issues;
}
