/**
 * Um vínculo de capability, na forma que o gate precisa — não é o `ConnectorBinding`
 * do banco: quem chama já resolveu se há conexão e qual o estado dela.
 */
export interface GateCapabilityBinding {
  readonly capability: string;
  readonly required: boolean;
  /** `undefined` quando a capability não tem vínculo nenhum. */
  readonly connectionId: string | undefined;
  /** `undefined` quando não há conexão vinculada — não confundir com "active". */
  readonly connectionStatus: "active" | "revoked" | undefined;
}

export interface EvaluateActivationInput {
  /** `false` quando a instância fixou uma versão que sumiu do catálogo. */
  readonly agentVersionExists: boolean;
  readonly configValid: boolean;
  /** Caminho de cada campo com problema — só relevante quando `configValid` é `false`. */
  readonly invalidConfigFields?: readonly string[];
  readonly capabilities: readonly GateCapabilityBinding[];
}

export type GateImpediment =
  | { readonly code: "AGENT_VERSION_MISSING" }
  | { readonly code: "CONFIG_INVALID"; readonly fields: readonly string[] }
  | { readonly code: "CAPABILITY_UNBOUND"; readonly capabilities: readonly string[] }
  | { readonly code: "CONNECTION_REVOKED"; readonly capabilities: readonly string[] };

export type GateResult = { readonly ok: true } | { readonly ok: false; readonly impediments: readonly GateImpediment[] };

/**
 * Decide se uma instância pode ativar — função pura, sem I/O, sem depender de banco
 * nem de framework. É o que torna o gate testável isoladamente e reutilizável pelo
 * worker do M2, que precisa reavaliar antes de cada execução (design §Componentes).
 *
 * `AGENT_VERSION_MISSING` é o único impedimento que encerra a avaliação sozinho: sem a
 * definição do agente não há como saber que capabilities são exigidas nem contra que
 * schema validar a config, então checar o resto não tem base nenhuma.
 */
export function evaluateActivation(input: EvaluateActivationInput): GateResult {
  if (!input.agentVersionExists) {
    return { ok: false, impediments: [{ code: "AGENT_VERSION_MISSING" }] };
  }

  const impediments: GateImpediment[] = [];

  if (!input.configValid) {
    impediments.push({ code: "CONFIG_INVALID", fields: input.invalidConfigFields ?? [] });
  }

  const unbound = input.capabilities
    .filter((binding) => binding.required && binding.connectionId === undefined)
    .map((binding) => binding.capability);
  if (unbound.length > 0) {
    impediments.push({ code: "CAPABILITY_UNBOUND", capabilities: unbound });
  }

  const revoked = input.capabilities
    .filter((binding) => binding.connectionId !== undefined && binding.connectionStatus === "revoked")
    .map((binding) => binding.capability);
  if (revoked.length > 0) {
    impediments.push({ code: "CONNECTION_REVOKED", capabilities: revoked });
  }

  return impediments.length === 0 ? { ok: true } : { ok: false, impediments };
}
