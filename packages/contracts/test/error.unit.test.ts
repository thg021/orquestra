import { describe, it, expect } from "vitest";
import { errorEnvelopeSchema } from "../src/error";

describe("errorEnvelopeSchema", () => {
  it("exige código e mensagem não vazios", () => {
    expect(errorEnvelopeSchema.safeParse({ code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." }).success).toBe(
      true
    );
    expect(errorEnvelopeSchema.safeParse({ code: "", message: "" }).success).toBe(false);
  });
});
