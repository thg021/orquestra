import { z } from "zod";
import { defineConnector } from "../define";
import { secret } from "../secret";

/**
 * Capability `email` — serve tanto para notificação quanto como via de entrega de
 * documento. Mesma ponte OAuth dos demais conectores Microsoft/Google até o M3 (D26).
 */
export const gmail = defineConnector({
  key: "gmail",
  title: "Gmail",
  capability: "email",
  kind: "native",
  authKind: "oauth",
  authSchema: z.object({
    refreshToken: secret(z.string().min(1)).meta({
      title: "Refresh token",
      description: "Obtido manualmente até o fluxo de autorização existir (M3)."
    })
  })
});
