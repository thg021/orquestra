import { z } from "zod";
import { defineConnector } from "../define";
import { secret } from "../secret";

/**
 * Capability `messaging`, opcional para o agente — um escritório que não use WhatsApp
 * simplesmente não faz esse binding (design §4). Adapter MCP sobre o WhatsApp Cloud API.
 */
export const whatsapp = defineConnector({
  key: "whatsapp",
  title: "WhatsApp",
  capability: "messaging",
  kind: "mcp",
  authKind: "api_key",
  authSchema: z.object({
    accessToken: secret(z.string().min(1)).meta({ title: "Token de acesso" }),
    phoneNumberId: z.string().min(1).meta({ title: "ID do número de telefone" })
  })
});
