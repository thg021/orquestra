import { z } from "zod";
import { defineConnector } from "../define";
import { secret } from "../secret";

/**
 * Microsoft Graph API — caminho preferido do tenant piloto para `file-storage`.
 *
 * `authKind: "oauth"`, mas o fluxo de redirect/callback só entra no M3 (D26): sem
 * adapter que consuma o token, não há como provar um fluxo de autorização. Até lá, o
 * `refreshToken` é colado à mão pelo admin, obtido fora da plataforma. O M3 substitui
 * o formulário por um botão "Conectar" — o formato salvo no cofre não muda.
 */
export const onedrive = defineConnector({
  key: "onedrive",
  title: "OneDrive (Microsoft Graph)",
  capability: "file-storage",
  kind: "native",
  authKind: "oauth",
  authSchema: z.object({
    refreshToken: secret(z.string().min(1)).meta({
      title: "Refresh token",
      description: "Obtido manualmente até o fluxo de autorização existir (M3)."
    })
  })
});
