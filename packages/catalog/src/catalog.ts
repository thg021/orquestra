import { accountingRoutine } from "./agents/accounting-routine";
import { platformUpload } from "./connectors/platform-upload";
import { onedrive } from "./connectors/onedrive";
import { googleDrive } from "./connectors/google-drive";
import { gmail } from "./connectors/gmail";
import { whatsapp } from "./connectors/whatsapp";
import { fortesConecta } from "./connectors/fortes-conecta";
import { validateCatalog, type CatalogIssue } from "./validate";

/**
 * O catálogo de verdade da Orquestra — o que a API expõe e o que o boot valida.
 * Lista explícita, não registro implícito por efeito colateral de import: acrescentar
 * um agente ou conector novo é uma linha aqui, visível no diff.
 */
export const AGENTS = [accountingRoutine] as const;

export const CONNECTORS = [
  platformUpload,
  onedrive,
  googleDrive,
  gmail,
  whatsapp,
  fortesConecta
] as const;

/** Chamado na subida da API — catálogo quebrado derruba o processo (CAT-03, CAT-04). */
export function validateBuiltinCatalog(): CatalogIssue[] {
  return validateCatalog({ agents: AGENTS, connectors: CONNECTORS });
}
