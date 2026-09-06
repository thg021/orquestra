import { z } from "zod";
import { defineConnector } from "../define";
import { secret } from "../secret";

/**
 * Capability `document-delivery` via API REST oficial — sem automação de navegador
 * (D10). Não usa `template_email`: a notificação vem do próprio Fortes Conecta.
 */
export const fortesConecta = defineConnector({
  key: "fortes-conecta",
  title: "Fortes Conecta",
  capability: "document-delivery",
  kind: "native",
  authKind: "api_key",
  authSchema: z.object({
    baseUrl: z.url().meta({ title: "URL base da API" }),
    apiKey: secret(z.string().min(1)).meta({ title: "Chave de API" })
  })
});
