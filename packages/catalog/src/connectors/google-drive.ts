import { z } from "zod";
import { defineConnector } from "../define";
import { secret } from "../secret";

/**
 * `file-storage` via adapter MCP — valida o caminho genérico de MCP (D5) além do
 * caminho nativo do OneDrive. Mesma ponte OAuth do onedrive.ts até o M3 (D26).
 */
export const googleDrive = defineConnector({
  key: "google-drive",
  title: "Google Drive",
  capability: "file-storage",
  kind: "mcp",
  authKind: "oauth",
  authSchema: z.object({
    refreshToken: secret(z.string().min(1)).meta({
      title: "Refresh token",
      description: "Obtido manualmente até o fluxo de autorização existir (M3)."
    })
  })
});
