# Frontend — React no painel

**Status:** normativo · **Data:** 2026-09-06 · **Milestone atual:** M1

Este documento diz como escrever código de painel na Orquestra. Vale para o Thiago e para qualquer agente de I.A. que abra `apps/web`.

## Versões

| Peça | Versão aqui | Onde está fixada |
| --- | --- | --- |
| react / react-dom | ^18.3.1 | `apps/web/package.json` |
| react-router-dom | ^7.0.2 | idem |
| vite | ^6.0.3 | idem |
| @vitejs/plugin-react | ^4.3.4 | idem |
| @testing-library/react | ^16.0.1 | idem |
| jsdom | ^25.0.1 | idem |
| zod | ^4.5.4 | `packages/contracts` (D30) |
| TypeScript | `strict` + `noUncheckedIndexedAccess` | `apps/web/tsconfig.json` |

O painel é **SPA**: React + Vite, sem SSR (D17). Isso não é acidente. Um bundle estático que fala com a API por HTTP é o mesmo artefato que vira app Tauri no Windows depois. Nada de loader de servidor, nada de framework mode do React Router.

---

## Regras invioláveis

Se uma delas quebra, o código não entra.

**1. Nenhum componente exibe, pede leitura ou guarda um segredo.**

```
  campo secreto  ->  <input type="password">      nunca type="text"
                 ->  value SEMPRE local           nunca vem do servidor
                 ->  texto de apoio: "•••• 4f2a"  só o last4
                 ->  editar = substituir          nunca visualizar
```

A API é write-only por construção (ADR-001, D8): não existe rota que devolva segredo. O painel não pode ser o lugar onde essa garantia vaza. Sem `localStorage`, sem `sessionStorage`, sem estado global, sem log, sem query string, sem `defaultValue` vindo de resposta HTTP.

**2. Mensagem de erro não carrega segredo, token nem string de conexão.** A tela mostra o que a API mandou ou um texto genérico. Não mostra `error.stack` nem o corpo cru da resposta.

**3. `apps/web/src/api/client.ts` é o único lugar que chama `fetch`.** Componente nenhum chama `fetch` direto. É o `apiFetch` que garante `credentials: "include"` (o cookie de sessão httpOnly) e o tratamento de 401.

**4. Sessão vive no cookie httpOnly, não no JavaScript.** Não existe token em memória, nem em storage. Quem sabe se há sessão é `GET /api/auth/me`.

**5. `web → contracts` e nada mais.** O painel importa tipo e schema de `@orquestra/contracts`. Nunca de `core`, `db` ou `api`.

**6. Toda tela nova nasce com teste.** Regra de co-locação do `TESTING.md`: a task que cria o componente escreve o teste na mesma task.

**7. Identificador em inglês, texto de tela em português** (D12).

---

## Estrutura de pastas

```
  apps/web/
    index.html            lang="pt-BR", só a raiz e o módulo
    vite.config.ts        proxy /api -> API (VITE_API_PROXY_TARGET)
    src/
      main.tsx            createRoot + StrictMode + liga o handler de 401
      router.tsx          createBrowserRouter, único lugar com rotas
      api/client.ts       apiFetch, ApiError, handler de 401
      components/         reutilizável entre rotas
      routes/             uma tela por arquivo, export default
      schema-form/        (M1) renderizador de formulário por JSON Schema
    test/
      api/ components/ routes/    espelha src/, arquivos *.unit.test.tsx
```

Regras de nome: arquivo em `kebab-case.tsx`, componente em `PascalCase`. Rota exporta `default`; componente de apoio exporta nomeado.

### Rotas

O roteador é declarado em um lugar só:

```tsx
// src/router.tsx
export const router = createBrowserRouter([
  { path: "/login", element: <LoginRoute /> },
  { path: "/*", element: <AppRoute /> }
]);
```

Rota protegida **não** usa `loader` nem `middleware` do React Router — o painel é SPA e a decisão de sessão é do componente. Quem protege é o `ProtectedRoute`, que consulta `/auth/me` e devolve os dados por render prop:

```tsx
<ProtectedRoute>
  {(me) => <div>{me.tenant.name}</div>}
</ProtectedRoute>
```

Navegação: `useNavigate()` dentro de handler, `<Navigate to replace />` durante render. Nunca `window.location`.

### O caminho de um 401

Existem dois 401 diferentes e eles não se misturam:

```
  login errado           -> skipUnauthorizedHandling: true -> mostra erro na tela
  sessão expirou no uso  -> handler global                 -> router.navigate("/login")
  erro de rede (fetch    -> nunca é 401                    -> não desloga ninguém
  rejeita)
```

O `client.ts` não conhece o roteador. Quem liga os dois é o `main.tsx`:

```tsx
setUnauthorizedHandler(() => {
  void router.navigate("/login");
});
```

Ao criar um fluxo novo, pergunte: "um 401 aqui significa sessão vencida?" Se não significa (login, troca de senha, verificação de credencial), passe `skipUnauthorizedHandling: true`.

---

## Estado e dados

Não há biblioteca de estado no projeto e não vamos adicionar uma sem conversa (regra do `CLAUDE.md`: dependência nova é avisada e justificada).

| Precisa de | Use |
| --- | --- |
| estado de um campo | `useState` no componente |
| dado do servidor em uma tela | `useEffect` + `apiFetch`, com flag de cancelamento |
| dado de sessão (`me`) | render prop do `ProtectedRoute` |
| algo compartilhado por 2+ telas | subir o estado ou `Context`; nunca variável de módulo |

O padrão de busca é sempre este — máquina de estados explícita e cancelamento no cleanup, que é o que evita resposta velha sobrescrever resposta nova (e o efeito rodar duas vezes no `StrictMode`):

```tsx
type State =
  | { status: "loading" }
  | { status: "ready"; data: Thing[] }
  | { status: "error"; message: string };

useEffect(() => {
  let cancelled = false;
  apiFetch<Thing[]>("/things")
    .then((data) => { if (!cancelled) setState({ status: "ready", data }); })
    .catch((error) => {
      if (cancelled) return;
      setState({
        status: "error",
        message: error instanceof ApiError ? error.message : "Não foi possível carregar."
      });
    });
  return () => { cancelled = true; };
}, []);
```

Três regras que caem junto com isso:

- **Sempre três estados.** Carregando, pronto, erro. Tela que só trata o caso feliz não passa em revisão.
- **Carregando é anunciado**: `<p role="status">Carregando…</p>`. O teste procura por `role`, não por texto solto.
- **Nunca fique preso em "carregando".** Se a checagem inicial falhar por rede, decida algo. O `ProtectedRoute` trata rede quebrada como não autenticado, de propósito, em vez de girar para sempre.

---

## Formulários e validação

Fonte da verdade da forma do dado é `packages/contracts` (Zod 4). O painel importa o **tipo** para tipar a chamada, e pode importar o **schema** para validar antes de enviar.

```tsx
import type { LoginResponse } from "@orquestra/contracts";

await apiFetch<LoginResponse>("/auth/login", {
  method: "POST",
  body: { email, password },
  skipUnauthorizedHandling: true
});
```

Padrão de submit, como no `login.tsx`:

```
  submit -> preventDefault
         -> se já está enviando, sai (guarda contra duplo clique)
         -> isSubmitting = true, erro = undefined
         -> await apiFetch
         -> sucesso: navega        erro: setErrorMessage(...)
         -> finally: isSubmitting = false
```

| Regra | Por quê |
| --- | --- |
| botão `disabled` enquanto envia | impede duplo submit; é o que o teste verifica |
| erro em `<p role="alert">` | leitor de tela anuncia; teste acha por `findByRole("alert")` |
| mensagem da API vence, com fallback genérico | a API já escreve sem revelar se o e-mail existe (AUTH-02) |
| erro de campo ao lado do campo | o 422 do M1 devolve campo + motivo |
| `autoComplete` correto (`username`, `current-password`) | gerenciador de senha funciona |

Não usamos `useActionState` / `useFormStatus` (React 19) porque estamos no 18 — ver Dívida de versão.

### Componentes prontos para o renderizador de formulário (M1)

No M1 chega `apps/web/src/schema-form`: a tela de configuração de uma instância é montada a partir do JSON Schema do agente, **sem tela escrita para aquele agente**. Componente de campo que não obedecer ao contrato abaixo não serve.

Contrato de um campo:

```
  <Field
     name="folderId"         caminho do campo no JSON Schema
     label="Pasta"           vem do schema (title), não hardcoded
     value / onChange        controlado, valor mora no formulário
     error="obrigatório"     vem do 422 da API ou da validação Zod
     secret={false}          marca do secret() no schema
  />
```

- **Sem estado interno de valor.** O campo é controlado. Quem guarda o objeto de config é o `schema-form`.
- **Sem texto fixo em português dentro do componente de campo.** Rótulo e ajuda vêm do schema.
- **Um componente por construto do subconjunto suportado**, e só desse subconjunto: `string`, `string` com `enum`, `string` com formato `email`/`uri`, `number`/`integer`, `boolean`, `array` de `string`, `object` de um nível. Construto fora disso é reprovado no boot pelo `validateCatalog` — não invente fallback na tela.
- **Campo com `secret()` renderiza mascarado**, começa vazio, e mostra `last4` como texto de apoio. Repetindo a regra 1: nem o valor nem parte dele vem do servidor.
- **Erro por campo é entrada, não invenção.** O `schema-form` recebe o mapa `campo -> motivo` do 422 e distribui.

---

## Testes de componente

Runner: Vitest, projeto `unit:web` no `vitest.workspace.ts` — arquivos `apps/web/**/*.unit.test.tsx`, ambiente `jsdom`. Gate da task: `pnpm typecheck && pnpm test:unit`.

O que testar:

| Testar | Não testar |
| --- | --- |
| o que o usuário vê e faz (`getByRole`, `findByRole`) | nome de estado interno, quantidade de render |
| os três estados: carregando, pronto, erro | classe CSS, estrutura de `div` |
| que o 401 leva ao lugar certo | implementação do `fetch` (isso é do teste de `client.ts`) |
| que segredo não vaza para storage | snapshot de árvore inteira |
| o payload enviado à API (`toHaveBeenCalledWith`) | detalhe de tempo (`setTimeout` mágico) |

Padrão do projeto: mock do `apiFetch`, `MemoryRouter` com a rota de destino registrada, `cleanup` no `afterEach`.

```tsx
vi.mock("../../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/client")>("../../src/api/client");
  return { ...actual, apiFetch: vi.fn() };
});
```

Um redirecionamento se prova renderizando a rota de destino e esperando o texto dela aparecer:

```tsx
<Route path="/login" element={<div>Tela de login</div>} />
// ...
await waitFor(() => expect(screen.queryByText("Tela de login")).not.toBeNull());
```

**Teste obrigatório em qualquer tela que toque credencial** (é gate de segurança da plataforma, item 4 do `TESTING.md`):

```tsx
expect(JSON.stringify(window.localStorage)).not.toContain("senha-super-secreta");
expect(JSON.stringify(window.sessionStorage)).not.toContain("senha-super-secreta");
```

Não há `@testing-library/jest-dom` instalado. Asserção é sobre valor puro: `.textContent`, `.not.toBeNull()`, `.disabled`.

---

## Acessibilidade mínima

Não é enfeite: é o que torna o teste possível sem depender de classe CSS.

```
  todo input          <label htmlFor> apontando para o id       obrigatório
  carregando          role="status"                             obrigatório
  erro de submit      role="alert"                              obrigatório
  botão               <button type="button|submit">             nunca <div onClick>
  página              um <h1> e um <main>                       obrigatório
  ícone sozinho       aria-label em português                   obrigatório
  campo inválido      aria-invalid + aria-describedby -> erro    obrigatório no M1
```

Regras de fundo: navegação por teclado tem que funcionar (ordem natural do DOM, sem `tabIndex` positivo); cor nunca é o único sinal de erro; `lang="pt-BR"` já está no `index.html` e fica.

---

## Dívida de versão

**Onde estamos:** React 18.3.1, React Router 7.0.2, Vite 6.0.3. Tudo funciona e nada está deprecado a ponto de quebrar.

O 18.3 é exatamente o 18.2 mais os avisos das APIs que o 19 remove — ou seja, já estamos no degrau que a própria equipe do React recomenda antes de migrar.

| Migração | O que ganharíamos | Risco |
| --- | --- | --- |
| React 18.3 → 19 | `useActionState` e `useFormStatus` (estado de submit sem `isSubmitting` na mão), `use()`, ref como prop, melhores erros de hidratação | Baixo/médio. Somos SPA e já usamos `createRoot`; nada de `ReactDOM.render` nem contexto legado no código. O atrito real é de **tipos**: os `@types/react` 19 são mais estritos (`props` de elemento, children implícito). Existe codemod: `npx types-react-codemod@latest preset-19 ./apps/web` |
| React Router 7 (lib) → framework mode | loaders, `middleware` de rota, code splitting por rota | **Não fazer.** Contraria o D17: framework mode empurra para SSR e mata o caminho do Tauri |
| Vite 6 → 7 | Node 20+ como base, build mais rápido | Baixo, mas sem ganho visível hoje. O `vite.config.ts` do projeto usa só `plugins` e `proxy` |

**Quando revisitar:** quando o `schema-form` do M1 estiver de pé. Formulário gerado é exatamente onde `useActionState` paga. Antes disso, migrar é mexer em código que ainda vai ser reescrito.

**O que NÃO fazer antes da conversa com o Thiago:** subir major de React, adicionar biblioteca de estado (Redux, Zustand, TanStack Query) ou de formulário (React Hook Form), ou trocar o roteador. Dependência nova passa por ele.

---

## Referências

- React 19 Upgrade Guide — https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- Synchronizing with Effects (cleanup e race condition) — https://react.dev/learn/synchronizing-with-effects
- You Might Not Need an Effect — https://react.dev/learn/you-might-not-need-an-effect
- `useActionState` / `useFormStatus` — https://react.dev/reference/react-dom/hooks
- React Router v7 — route object, `lazy`, `middleware` — https://reactrouter.com/start/data/route-object
- React Router v7 — `redirect` — https://reactrouter.com/api/utils/redirect
- Interno: `.specs/codebase/TESTING.md`, `.specs/features/pluggable-core/design.md` (§Renderizador de formulário), `docs/adr/001-gestao-de-segredos-de-conectores.md`, `.specs/project/STATE.md` (D17, D23, D30)
