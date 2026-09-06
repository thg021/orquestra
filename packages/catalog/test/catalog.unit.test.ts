import { describe, it, expect } from "vitest";
import { validateCatalog } from "../src/validate";
import { accountingRoutine } from "../src/agents/accounting-routine";
import { platformUpload } from "../src/connectors/platform-upload";
import { onedrive } from "../src/connectors/onedrive";
import { googleDrive } from "../src/connectors/google-drive";
import { gmail } from "../src/connectors/gmail";
import { whatsapp } from "../src/connectors/whatsapp";
import { fortesConecta } from "../src/connectors/fortes-conecta";

describe("catálogo real do M1", () => {
  it("valida sem achados: toda capability exigida pelo agente tem conector", () => {
    const issues = validateCatalog({
      agents: [accountingRoutine],
      connectors: [platformUpload, onedrive, googleDrive, gmail, whatsapp, fortesConecta]
    });

    expect(issues).toEqual([]);
  });
});
