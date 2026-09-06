import { describe, it, expect } from "vitest";
import { hasAtLeast } from "../src/roles";

describe("hasAtLeast", () => {
  it("respeita a precedência owner > admin > operator", () => {
    expect(hasAtLeast("owner", "admin")).toBe(true);
    expect(hasAtLeast("owner", "operator")).toBe(true);
    expect(hasAtLeast("admin", "operator")).toBe(true);
    expect(hasAtLeast("operator", "admin")).toBe(false);
    expect(hasAtLeast("admin", "owner")).toBe(false);
    expect(hasAtLeast("operator", "owner")).toBe(false);
  });

  it("é reflexivo: papel igual ao exigido é suficiente", () => {
    expect(hasAtLeast("owner", "owner")).toBe(true);
    expect(hasAtLeast("admin", "admin")).toBe(true);
    expect(hasAtLeast("operator", "operator")).toBe(true);
  });
});
