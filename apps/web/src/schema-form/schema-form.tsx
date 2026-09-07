import { useId } from "react";

/**
 * Subconjunto de JSON Schema que o painel sabe desenhar — o mesmo que
 * `checkFormSchemaSupport` (packages/catalog) garante na subida do servidor: texto (com
 * ou sem enum), número, booleano, lista de texto, e objeto de um nível só.
 */
export interface JsonPropertySchema {
  type: "string" | "number" | "integer" | "boolean" | "array";
  enum?: readonly string[];
  items?: { type: "string" };
  title?: string;
  description?: string;
  /** Marca de `secret()` (packages/catalog/src/secret.ts) — nunca populado com valor do servidor. */
  secret?: boolean;
}

export interface JsonObjectSchema {
  type: "object";
  properties: Record<string, JsonPropertySchema>;
  required?: readonly string[];
}

export interface FieldError {
  path: string;
  message: string;
}

export interface SchemaFormProps {
  schema: JsonObjectSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  fieldErrors?: FieldError[];
}

function toTextareaValue(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : "";
}

/**
 * Um campo por propriedade de primeiro nível do schema. Campo `secret` nunca lê de
 * `values` — sempre nasce vazio, mesmo que o servidor tenha mandado algo em `values`
 * (não deveria, mas o componente não confia nisso: é a garantia local do INST-03).
 */
export function SchemaForm({ schema, values, onChange, fieldErrors = [] }: SchemaFormProps) {
  const formId = useId();
  const requiredFields = new Set(schema.required ?? []);

  function setField(name: string, value: unknown): void {
    onChange({ ...values, [name]: value });
  }

  function errorFor(name: string): string | undefined {
    return fieldErrors.find((error) => error.path === name)?.message;
  }

  return (
    <div>
      {Object.entries(schema.properties).map(([name, property]) => {
        const fieldId = `${formId}-${name}`;
        const label = property.title ?? name;
        const required = requiredFields.has(name);
        const error = errorFor(name);

        return (
          <div key={name}>
            <label htmlFor={fieldId}>{label}</label>

            {property.secret ? (
              // Sem `required` HTML: o campo sempre renderiza vazio de propósito (nunca
              // recebe valor do servidor), então a validação nativa do navegador
              // bloquearia o submit mesmo com um valor já digitado — quem valida
              // presença de segredo é o servidor (422 AUTH_INVALID/CONFIG_INVALID).
              <input
                id={fieldId}
                type="password"
                value=""
                autoComplete="new-password"
                onChange={(event) => setField(name, event.target.value)}
              />
            ) : property.type === "boolean" ? (
              <input
                id={fieldId}
                type="checkbox"
                checked={Boolean(values[name])}
                onChange={(event) => setField(name, event.target.checked)}
              />
            ) : property.type === "array" ? (
              <textarea
                id={fieldId}
                value={toTextareaValue(values[name])}
                required={required}
                onChange={(event) =>
                  setField(
                    name,
                    event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0)
                  )
                }
              />
            ) : property.enum ? (
              <select
                id={fieldId}
                value={typeof values[name] === "string" ? (values[name] as string) : ""}
                required={required}
                onChange={(event) => setField(name, event.target.value)}
              >
                <option value="" disabled>
                  Selecione…
                </option>
                {property.enum.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : property.type === "number" || property.type === "integer" ? (
              <input
                id={fieldId}
                type="number"
                value={typeof values[name] === "number" ? values[name] : ""}
                required={required}
                onChange={(event) => setField(name, event.target.value === "" ? undefined : Number(event.target.value))}
              />
            ) : (
              <input
                id={fieldId}
                type="text"
                value={typeof values[name] === "string" ? (values[name] as string) : ""}
                required={required}
                onChange={(event) => setField(name, event.target.value)}
              />
            )}

            {property.description ? <p>{property.description}</p> : null}
            {error ? <p role="alert">{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
