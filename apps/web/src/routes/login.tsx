import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import type { LoginResponse } from "@orquestra/contracts";

const GENERIC_ERROR_MESSAGE = "Não foi possível entrar. Tente novamente.";

export default function LoginRoute() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(undefined);

    try {
      await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
        // login() nunca dispara o handler global de sessão expirada — 401 aqui é
        // credencial errada, não sessão vencida.
        skipUnauthorizedHandling: true
      });
      navigate("/", { replace: true });
    } catch (caughtError) {
      // A API já devolve mensagem genérica ("E-mail ou senha inválidos.") sem revelar
      // se o e-mail existe (AUTH-02); qualquer outro erro (rede, 500) cai no fallback.
      setErrorMessage(caughtError instanceof ApiError ? caughtError.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Entrar</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="login-email">E-mail</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
        />

        <label htmlFor="login-password">Senha</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />

        {errorMessage ? <p role="alert">{errorMessage}</p> : null}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
