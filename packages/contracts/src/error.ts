import { z } from "zod";

// Envelope de erro de toda a API: código estável para lógica de cliente, mensagem em
// português já pronta para exibição (traduzida a partir do DomainError na borda).
export const errorEnvelopeSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
