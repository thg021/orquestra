import { describe, it, expect } from "vitest";
import { newId } from "../src/id";

const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("produz um UUID v7 válido (versão e variante corretas)", () => {
    const id = newId();
    expect(id).toMatch(UUID_V7_REGEX);
  });

  it("é monotônico dentro do mesmo milissegundo", () => {
    const ids = Array.from({ length: 200 }, () => newId());
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  it("gera identificadores distintos entre si", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });
});
