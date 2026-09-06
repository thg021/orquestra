import type { CatalogIssue } from "@orquestra/catalog";

function describe(issue: CatalogIssue): string {
  switch (issue.code) {
    case "DUPLICATE_AGENT_KEY":
      return `chave de agente duplicada: "${issue.key}"`;
    case "DUPLICATE_CONNECTOR_KEY":
      return `chave de conector duplicada: "${issue.key}"`;
    case "INVALID_KEY":
      return `chave inválida: "${issue.key}"`;
    case "INVALID_VERSION":
      return `versão inválida em "${issue.key}": "${issue.version}"`;
    case "CAPABILITY_ORPHANED":
      return `agente "${issue.agentKey}" exige a capability "${issue.capability}", mas nenhum conector a satisfaz`;
    case "UNSUPPORTED_FORM_SCHEMA":
      return `"${issue.key}" tem schema fora do subconjunto suportado pelo formulário: ${issue.paths.join(", ")}`;
  }
}

/**
 * Lançado no boot quando `validateBuiltinCatalog()` encontra qualquer problema.
 * Carrega TODOS os achados na mensagem — nomear só o primeiro faria o operador
 * corrigir um problema, subir de novo, achar o segundo, e repetir.
 */
export class InvalidCatalogError extends Error {
  public readonly issues: readonly CatalogIssue[];

  constructor(issues: readonly CatalogIssue[]) {
    const summary = issues.map(describe).join(" | ");
    super(`Catálogo inválido: ${issues.length} problema(s). ${summary}`);
    this.name = "InvalidCatalogError";
    this.issues = issues;
  }
}
