import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { AgentSummary, ConnectorSummary, ConnectionSummary, ServiceInstanceSummary } from "@orquestra/contracts";
import { getAgents, getConnectors } from "../../api/catalog";
import { getServiceInstance, updateServiceInstance, activateServiceInstance, pauseServiceInstance } from "../../api/service-instances";
import { listBindings, bindCapability, unbindCapability } from "../../api/bindings";
import { listConnections } from "../../api/connections";
import { ApiError, type ApiFieldError } from "../../api/client";
import { SchemaForm, type JsonObjectSchema } from "../../schema-form/schema-form";

type Tab = "config" | "connections";

interface Impediment {
  code: string;
  fields?: string[];
  capabilities?: string[];
}

function impedimentLabel(impediment: Impediment): string {
  switch (impediment.code) {
    case "AGENT_VERSION_MISSING":
      return "A versão deste agente não está mais disponível no catálogo.";
    case "CONFIG_INVALID":
      return `Configuração inválida: ${(impediment.fields ?? []).join(", ")}`;
    case "CAPABILITY_UNBOUND":
      return `Capability obrigatória sem vínculo: ${(impediment.capabilities ?? []).join(", ")}`;
    case "CONNECTION_REVOKED":
      return `Conexão revogada para: ${(impediment.capabilities ?? []).join(", ")}`;
    default:
      return impediment.code;
  }
}

function impedimentTab(impediment: Impediment): Tab {
  return impediment.code === "CONFIG_INVALID" ? "config" : "connections";
}

export default function ServiceInstanceRoute() {
  const { id } = useParams<{ id: string }>();
  const [instance, setInstance] = useState<ServiceInstanceSummary>();
  const [agents, setAgents] = useState<AgentSummary[]>();
  const [connectors, setConnectors] = useState<ConnectorSummary[]>();
  const [connections, setConnections] = useState<ConnectionSummary[]>();
  const [bindings, setBindings] = useState<{ capability: string; connectionId: string }[]>();
  const [tab, setTab] = useState<Tab>("config");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [configErrors, setConfigErrors] = useState<ApiFieldError[]>();
  const [activationImpediments, setActivationImpediments] = useState<Impediment[]>();
  const [actionMessage, setActionMessage] = useState<string | undefined>();

  const reload = useCallback(async () => {
    if (!id) return;
    const [instanceResult, agentsResult, connectorsResult, connectionsResult, bindingsResult] = await Promise.all([
      getServiceInstance(id),
      getAgents(),
      getConnectors(),
      listConnections(),
      listBindings(id)
    ]);
    setInstance(instanceResult);
    setConfig(instanceResult.config as Record<string, unknown>);
    setAgents(agentsResult);
    setConnectors(connectorsResult);
    setConnections(connectionsResult);
    setBindings(bindingsResult);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!instance || !agents || !connectors || !connections || !bindings || !id) {
    return <p role="status">Carregando…</p>;
  }

  const agent = agents.find((candidate) => candidate.key === instance.agentKey && candidate.version === instance.agentVersion);

  async function handleSaveConfig(): Promise<void> {
    setConfigErrors(undefined);
    setActionMessage(undefined);
    try {
      await updateServiceInstance(id!, { config });
      await reload();
      setActionMessage("Configuração salva.");
    } catch (error) {
      if (error instanceof ApiError) {
        setConfigErrors(error.fields);
      }
    }
  }

  async function handleActivate(): Promise<void> {
    setActivationImpediments(undefined);
    setActionMessage(undefined);
    try {
      await activateServiceInstance(id!);
      await reload();
    } catch (error) {
      if (error instanceof ApiError && error.impediments) {
        setActivationImpediments(error.impediments as unknown as Impediment[]);
      }
    }
  }

  async function handlePause(): Promise<void> {
    await pauseServiceInstance(id!);
    await reload();
  }

  async function handleBind(capability: string, connectionId: string): Promise<void> {
    if (!connectionId) return;
    await bindCapability(id!, capability, connectionId);
    await reload();
  }

  async function handleUnbind(capability: string): Promise<void> {
    await unbindCapability(id!, capability);
    await reload();
  }

  return (
    <section>
      <h1>{instance.name}</h1>
      <p>Status: {instance.status}</p>
      {instance.statusReason ? <p>Motivo: {instance.statusReason}</p> : null}

      <button type="button" onClick={handleActivate} disabled={instance.status === "active"}>
        Ativar
      </button>
      <button type="button" onClick={handlePause} disabled={instance.status !== "active"}>
        Pausar
      </button>

      {activationImpediments ? (
        <div role="alert">
          <p>Não é possível ativar:</p>
          <ul>
            {activationImpediments.map((impediment) => (
              <li key={impediment.code}>
                {impedimentLabel(impediment)}{" "}
                <button type="button" onClick={() => setTab(impedimentTab(impediment))}>
                  Resolver
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionMessage ? <p role="status">{actionMessage}</p> : null}

      <nav>
        <button type="button" onClick={() => setTab("config")} aria-current={tab === "config"}>
          Configuração
        </button>
        <button type="button" onClick={() => setTab("connections")} aria-current={tab === "connections"}>
          Conexões
        </button>
      </nav>

      {tab === "config" ? (
        <div>
          {agent ? (
            <SchemaForm
              schema={agent.configSchema as JsonObjectSchema}
              values={config}
              onChange={setConfig}
              fieldErrors={configErrors}
            />
          ) : (
            <p>A versão do agente desta instância não está mais disponível no catálogo.</p>
          )}
          <button type="button" onClick={handleSaveConfig}>
            Salvar
          </button>
        </div>
      ) : (
        <ul>
          {(agent?.capabilities ?? []).map((requirement) => {
            const binding = bindings.find((candidate) => candidate.capability === requirement.capability);
            const connection = binding ? connections.find((candidate) => candidate.id === binding.connectionId) : undefined;
            const compatibleConnections = connections.filter((candidate) => {
              const connector = connectors.find((c) => c.key === candidate.connectorKey);
              return connector?.capability === requirement.capability;
            });

            return (
              <li key={requirement.capability}>
                <strong>{requirement.capability}</strong> — {requirement.required ? "obrigatória" : "opcional"}
                {" — "}
                {connection ? `vinculada a "${connection.name}"` : "não vinculada"}

                {connection ? (
                  <button type="button" onClick={() => handleUnbind(requirement.capability)}>
                    Desvincular
                  </button>
                ) : (
                  <BindForm
                    capability={requirement.capability}
                    options={compatibleConnections}
                    onBind={handleBind}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BindForm({
  capability,
  options,
  onBind
}: {
  capability: string;
  options: ConnectionSummary[];
  onBind: (capability: string, connectionId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const selectId = `bind-${capability}`;

  return (
    <span>
      <label htmlFor={selectId}>Conexão para {capability}</label>
      <select id={selectId} value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Selecione…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => onBind(capability, selected)} disabled={!selected}>
        Vincular
      </button>
    </span>
  );
}
