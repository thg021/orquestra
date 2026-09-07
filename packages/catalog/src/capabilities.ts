/**
 * Capability é o contrato entre agente e conector: o agente declara o que precisa,
 * o conector declara o que entrega, e o binding liga os dois. É o que permite trocar
 * de fornecedor (OneDrive por Google Drive) sem o agente saber.
 *
 * Entrada e saída são capabilities distintas. `file-storage` é como o documento chega
 * à plataforma — escolha única do escritório. As de saída (`document-delivery`,
 * `email`, `messaging`) coexistem, e a escolha entre elas é por destinatário, resolvida
 * pelo agente em tempo de execução.
 */
export const CAPABILITIES = ["file-storage", "email", "messaging", "document-delivery"] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
