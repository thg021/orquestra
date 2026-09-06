import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import type { MeResponse } from "@orquestra/contracts";

interface ProtectedRouteProps {
  children: (me: MeResponse) => ReactNode;
}

type ProtectedRouteState =
  | { status: "loading" }
  | { status: "authenticated"; me: MeResponse }
  | { status: "unauthenticated" };

/**
 * Checagem inicial de sessão é dona do próprio 401 (skipUnauthorizedHandling) — quem
 * decide redirecionar ao login aqui é este componente, não o handler global do
 * client.ts (esse fica reservado pra sessão que expira DURANTE o uso, em qualquer
 * outra chamada, SHELL-05).
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [state, setState] = useState<ProtectedRouteState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    apiFetch<MeResponse>("/auth/me", { skipUnauthorizedHandling: true })
      .then((me) => {
        if (!cancelled) {
          setState({ status: "authenticated", me });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError) {
          setState({ status: "unauthenticated" });
        } else {
          // Erro de rede/inesperado na checagem inicial: sem sessão confirmada, trata
          // como não autenticado em vez de travar em carregamento pra sempre.
          setState({ status: "unauthenticated" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p role="status">Carregando…</p>;
  }

  if (state.status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <>{children(state.me)}</>;
}
