import { useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../components/protected-route";
import { apiFetch } from "../api/client";

export default function AppRoute() {
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    // Falha ao revogar no servidor não deve prender o usuário na tela — o cookie some
    // do lado do cliente de qualquer forma ao navegar pro login.
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    navigate("/login", { replace: true });
  }

  return (
    <ProtectedRoute>
      {(me) => (
        <div>
          <header>
            <span>{me.tenant.name}</span>
            <span>{me.user.email}</span>
            <button type="button" onClick={handleLogout}>
              Sair
            </button>
          </header>
          <main>{/* conteúdo funcional chega nos milestones seguintes */}</main>
        </div>
      )}
    </ProtectedRoute>
  );
}
