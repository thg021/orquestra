import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentSummary } from "@orquestra/contracts";
import { getAgents } from "../../api/catalog";
import { createServiceInstance } from "../../api/service-instances";
import { ApiError } from "../../api/client";
import { SchemaForm, type JsonObjectSchema } from "../../schema-form/schema-form";

const GENERIC_ERROR_MESSAGE = "Não foi possível instalar. Tente novamente.";

/** Um card por agente do catálogo — nenhum campo aqui conhece um agente específico. */
function AgentCard({ agent }: { agent: AgentSummary }) {
  const navigate = useNavigate();
  const [isInstalling, setIsInstalling] = useState(false);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<{ path: string; message: string }[]>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(undefined);
    setFieldErrors(undefined);

    try {
      const created = await createServiceInstance({ agentKey: agent.key, name, config });
      navigate(`/service-instances/${created.id}`);
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        setErrorMessage(caughtError.message);
        setFieldErrors(caughtError.fields);
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article>
      <h2>{agent.title}</h2>
      <p>{agent.description}</p>
      <ul>
        {agent.capabilities.map((requirement) => (
          <li key={requirement.capability}>
            {requirement.capability} — {requirement.required ? "obrigatória" : "opcional"}
          </li>
        ))}
      </ul>

      {isInstalling ? (
        <form onSubmit={handleSubmit}>
          <label htmlFor={`nome-${agent.key}`}>Nome da instância</label>
          <input
            id={`nome-${agent.key}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />

          <SchemaForm
            schema={agent.configSchema as JsonObjectSchema}
            values={config}
            onChange={setConfig}
            fieldErrors={fieldErrors}
          />

          {errorMessage ? <p role="alert">{errorMessage}</p> : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Criando…" : "Criar"}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setIsInstalling(true)}>
          Instalar
        </button>
      )}
    </article>
  );
}

export default function CatalogRoute() {
  const [agents, setAgents] = useState<AgentSummary[]>();

  useEffect(() => {
    let cancelled = false;
    getAgents().then((result) => {
      if (!cancelled) setAgents(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!agents) {
    return <p role="status">Carregando…</p>;
  }

  return (
    <section>
      <h1>Catálogo</h1>
      {agents.map((agent) => (
        <AgentCard key={`${agent.key}@${agent.version}`} agent={agent} />
      ))}
    </section>
  );
}
