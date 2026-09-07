import { z } from "zod";
import { CAPABILITIES, isCapability, type Capability } from "./capabilities";
import { InvalidDefinitionError } from "./errors";
import { isSecret } from "./secret";

// Slug: minúsculas, dígitos e hífen. É o que aparece em URL, em coluna de banco e em
// nome de arquivo — restringir aqui evita descobrir o problema em cada um deles.
const SLUG = /^[a-z][a-z0-9-]*$/;

// Semver simples (maior.menor.correção). Pré-release e build metadata não são aceitos:
// uma instância fixa a versão do agente, e faixa de versão instável ali não ajuda ninguém.
const SEMVER = /^\d+\.\d+\.\d+$/;

export interface CapabilityRequirement {
  readonly capability: Capability;
  readonly required: boolean;
}

export interface DataCollection {
  readonly key: string;
  readonly schema: z.ZodType;
}

export interface AgentDefinitionInput {
  readonly key: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly configSchema: z.ZodType;
  readonly capabilities: readonly CapabilityRequirement[];
  readonly dataCollections: readonly DataCollection[];
}

export interface AgentDefinition extends AgentDefinitionInput {
  /** Identificador estável usado pela instância: `key@version`. */
  readonly ref: string;
  readonly requiredCapabilities: readonly Capability[];
  readonly optionalCapabilities: readonly Capability[];
}

function assertSlug(kind: string, value: string): void {
  if (!SLUG.test(value)) {
    throw new InvalidDefinitionError(
      `Chave de ${kind} inválida: "${value}". Use minúsculas, dígitos e hífen.`
    );
  }
}

function assertSemver(ref: string, version: string): void {
  if (!SEMVER.test(version)) {
    throw new InvalidDefinitionError(
      `Versão inválida em "${ref}": "${version}". Use o formato maior.menor.correção.`
    );
  }
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

/**
 * Declara um agente do catálogo. Valida na hora da chamada: definição malformada não
 * chega a existir como objeto.
 */
export function defineAgent(input: AgentDefinitionInput): AgentDefinition {
  assertSlug("agente", input.key);
  assertSemver(input.key, input.version);

  if (input.capabilities.length === 0) {
    throw new InvalidDefinitionError(
      `Agente "${input.key}" não declara nenhuma capability. Um agente que não precisa de conector não precisa da plataforma.`
    );
  }

  const duplicatedCapability = findDuplicate(input.capabilities.map((item) => item.capability));
  if (duplicatedCapability !== undefined) {
    throw new InvalidDefinitionError(
      `Agente "${input.key}" declara a capability "${duplicatedCapability}" duas vezes.`
    );
  }

  const duplicatedCollection = findDuplicate(input.dataCollections.map((item) => item.key));
  if (duplicatedCollection !== undefined) {
    throw new InvalidDefinitionError(
      `Agente "${input.key}" declara a coleção "${duplicatedCollection}" duas vezes.`
    );
  }

  for (const collection of input.dataCollections) {
    assertSlug("coleção", collection.key);
  }

  return {
    ...input,
    ref: `${input.key}@${input.version}`,
    requiredCapabilities: input.capabilities.filter((c) => c.required).map((c) => c.capability),
    optionalCapabilities: input.capabilities.filter((c) => !c.required).map((c) => c.capability)
  };
}

/** `native` é adapter em TypeScript; `mcp` aponta um MCP server e mapeia tools. */
export const CONNECTOR_KINDS = ["native", "mcp"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/** Como o escritório autentica no fornecedor. `oauth` só ganha fluxo no M3. */
export const AUTH_KINDS = ["api_key", "oauth", "form"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

export interface ConnectorDefinitionInput {
  readonly key: string;
  readonly title: string;
  readonly capability: Capability;
  readonly kind: ConnectorKind;
  readonly authKind: AuthKind;
  readonly authSchema: z.ZodObject;
}

export interface ConnectorDefinition extends ConnectorDefinitionInput {
  /** Campos marcados com `secret()` — vão cifrados para o cofre. */
  readonly secretFields: readonly string[];
  /** Campos sem marca — ficam legíveis para o painel exibir. */
  readonly metadataFields: readonly string[];
}

function assertOneOf(kind: string, allowed: readonly string[], value: string, key: string): void {
  if (!allowed.includes(value)) {
    throw new InvalidDefinitionError(
      `Conector "${key}" declara ${kind} inválido: "${value}". Valores aceitos: ${allowed.join(", ")}.`
    );
  }
}

/**
 * Declara um conector do catálogo. Como o agente, valida na chamada — e exige que ao
 * menos um campo de autenticação seja secreto: conector sem segredo não custodia
 * credencial nenhuma, e provavelmente é erro de quem escreveu.
 */
export function defineConnector(input: ConnectorDefinitionInput): ConnectorDefinition {
  assertSlug("conector", input.key);

  if (!isCapability(input.capability)) {
    assertOneOf("capability", CAPABILITIES, input.capability, input.key);
  }
  assertOneOf("tipo de adapter", CONNECTOR_KINDS, input.kind, input.key);
  assertOneOf("tipo de autenticação", AUTH_KINDS, input.authKind, input.key);

  const fields = Object.entries(input.authSchema.shape);
  const secretFields = fields.filter(([, schema]) => isSecret(schema)).map(([name]) => name);
  const metadataFields = fields.filter(([, schema]) => !isSecret(schema)).map(([name]) => name);

  if (secretFields.length === 0) {
    throw new InvalidDefinitionError(
      `Conector "${input.key}" não marca nenhum campo com secret(). Sem isso, a credencial iria em texto claro para o banco.`
    );
  }

  return { ...input, secretFields, metadataFields };
}
