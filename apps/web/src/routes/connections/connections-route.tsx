import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ConnectorSummary, ConnectionSummary } from "@orquestra/contracts";
import { getConnectors } from "../../api/catalog";
import {
  listConnections,
  createConnection,
  replaceConnectionSecret,
  revokeConnection,
  checkConnection
} from "../../api/connections";
import { ApiError, type ApiFieldError } from "../../api/client";
import { SchemaForm, type JsonObjectSchema } from "../../schema-form/schema-form";

const GENERIC_ERROR_MESSAGE = "Não foi possível concluir a ação. Tente novamente.";

function checkLabel(connection: ConnectionSummary): string {
  if (!connection.lastCheckAt) {
    return "Nunca verificada";
  }
  if (connection.lastCheckStatus === "ok") {
    return `Verificada com sucesso em ${connection.lastCheckAt}`;
  }
  if (connection.lastCheckStatus === "failed") {
    return `Falha na verificação em ${connection.lastCheckAt}`;
  }
  return `Verificação pendente desde ${connection.lastCheckAt}`;
}

function NewConnectionForm({
  connectors,
  onCreated
}: {
  connectors: ConnectorSummary[];
  onCreated: () => Promise<void>;
}) {
  const [connectorKey, setConnectorKey] = useState("");
  const [name, setName] = useState("");
  const [auth, setAuth] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<ApiFieldError[]>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const connector = connectors.find((candidate) => candidate.key === connectorKey);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFieldErrors(undefined);
    setErrorMessage(undefined);
    try {
      await createConnection({ connectorKey, name, auth });
      setName("");
      setAuth({});
      await onCreated();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        setErrorMessage(error.fields ? undefined : error.message);
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Nova conexão</h2>
      <label htmlFor="connector-key">Fornecedor</label>
      <select id="connector-key" value={connectorKey} onChange={(event) => setConnectorKey(event.target.value)} required>
        <option value="" disabled>
          Selecione…
        </option>
        {connectors.map((option) => (
          <option key={option.key} value={option.key}>
            {option.title}
          </option>
        ))}
      </select>

      <label htmlFor="connection-name">Nome</label>
      <input id="connection-name" value={name} onChange={(event) => setName(event.target.value)} required />

      {connector ? (
        <SchemaForm
          schema={connector.authSchema as JsonObjectSchema}
          values={auth}
          onChange={setAuth}
          fieldErrors={fieldErrors}
        />
      ) : null}

      {errorMessage ? <p role="alert">{errorMessage}</p> : null}

      <button type="submit" disabled={!connector}>
        Criar
      </button>
    </form>
  );
}

function ReplaceSecretForm({
  connection,
  connector,
  onReplaced
}: {
  connection: ConnectionSummary;
  connector: ConnectorSummary | undefined;
  onReplaced: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<ApiFieldError[]>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Substituir credencial
      </button>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFieldErrors(undefined);
    setErrorMessage(undefined);
    try {
      await replaceConnectionSecret(connection.id, auth);
      setOpen(false);
      setAuth({});
      await onReplaced();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        setErrorMessage(error.fields ? undefined : error.message);
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {connector ? (
        <SchemaForm
          schema={connector.authSchema as JsonObjectSchema}
          values={auth}
          onChange={setAuth}
          fieldErrors={fieldErrors}
        />
      ) : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      <button type="submit">Salvar credencial</button>
    </form>
  );
}

export default function ConnectionsRoute() {
  const [connections, setConnections] = useState<ConnectionSummary[]>();
  const [connectors, setConnectors] = useState<ConnectorSummary[]>();
  const [revokeMessage, setRevokeMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const reload = useCallback(async () => {
    const [connectionsResult, connectorsResult] = await Promise.all([listConnections(), getConnectors()]);
    setConnections(connectionsResult);
    setConnectors(connectorsResult);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleRevoke(id: string): Promise<void> {
    setActionError(undefined);
    try {
      const result = await revokeConnection(id);
      setRevokeMessage(`Conexão revogada. ${result.pausedInstanceCount} serviços foram pausados.`);
      await reload();
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : GENERIC_ERROR_MESSAGE);
    }
  }

  async function handleCheck(id: string): Promise<void> {
    setActionError(undefined);
    try {
      await checkConnection(id);
      await reload();
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : GENERIC_ERROR_MESSAGE);
    }
  }

  if (!connections || !connectors) {
    return <p role="status">Carregando…</p>;
  }

  return (
    <section>
      <h1>Conexões</h1>
      {revokeMessage ? <p role="status">{revokeMessage}</p> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}

      <ul>
        {connections.map((connection) => {
          const connector = connectors.find((candidate) => candidate.key === connection.connectorKey);
          return (
            <li key={connection.id}>
              <strong>{connection.name}</strong> — {connector?.title ?? connection.connectorKey} — ****
              {connection.last4} — {connection.status === "revoked" ? "revogada" : "ativa"} — {checkLabel(connection)}
              <button type="button" onClick={() => handleCheck(connection.id)} disabled={connection.status === "revoked"}>
                Verificar
              </button>
              {connection.status !== "revoked" ? (
                <>
                  <ReplaceSecretForm connection={connection} connector={connector} onReplaced={reload} />
                  <button type="button" onClick={() => handleRevoke(connection.id)}>
                    Revogar
                  </button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      <NewConnectionForm connectors={connectors} onCreated={reload} />
    </section>
  );
}
