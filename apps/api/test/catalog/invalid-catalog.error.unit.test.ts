import { describe, it, expect } from "vitest";
import type { CatalogIssue } from "@orquestra/catalog";
import { InvalidCatalogError } from "../../src/catalog/invalid-catalog.error";

describe("InvalidCatalogError", () => {
  it("carrega todos os achados, não só o primeiro", () => {
    const issues: CatalogIssue[] = [
      { code: "DUPLICATE_AGENT_KEY", key: "accounting-routine" },
      { code: "CAPABILITY_ORPHANED", agentKey: "accounting-routine", capability: "messaging" }
    ];

    const error = new InvalidCatalogError(issues);

    expect(error.issues).toEqual(issues);
    expect(error.message).toContain("accounting-routine");
    expect(error.message).toContain("messaging");
    expect(error.message).toContain("2");
  });

  it("nomeia o agente e a capability num achado órfão", () => {
    const error = new InvalidCatalogError([
      { code: "CAPABILITY_ORPHANED", agentKey: "x", capability: "y" }
    ]);

    expect(error.message).toContain("x");
    expect(error.message).toContain("y");
  });
});
