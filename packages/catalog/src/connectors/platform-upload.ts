import { z } from "zod";
import { defineConnector } from "../define";
import { secret } from "../secret";

/**
 * Storage da própria plataforma — o adapter de menor risco de `file-storage`, porque
 * não depende de credencial de terceiro. Por isso vem primeiro no roadmap (M3) e é o
 * primeiro conector real do catálogo.
 */
export const platformUpload = defineConnector({
  key: "platform-upload",
  title: "Upload direto na plataforma",
  capability: "file-storage",
  kind: "native",
  authKind: "api_key",
  authSchema: z.object({
    apiKey: secret(z.string().min(1)).meta({ title: "Chave de acesso" })
  })
});
