# Backend — NestJS

**Stack:** NestJS 10.4 · Node + TypeScript · Express 4 (runtime) · Zod 4.5 · Vitest
**Data:** 2026-09-06
**Vale para:** `apps/api/**`

Este documento diz como escrever código de backend na Orquestra. Ele descreve o que já existe no `apps/api`, não boas práticas genéricas de internet. Quando o código e este documento discordarem, o código manda — e o documento é corrigido.

---

## Regras invioláveis

Comece por aqui. Cada uma nasceu de erro real ou de decisão registrada.

| # | Regra | Se quebrar |
| --- | --- | --- |
| 1 | Todo construtor de controller/provider usa `@Inject(Token)` explícito | O parâmetro chega `undefined` sob teste, sem erro |
| 2 | `packages/core`, `packages/db` e `packages/catalog` nunca importam NestJS | O domínio vira refém do framework |
| 3 | Nenhum erro, log ou resposta carrega senha, token, chave ou string de conexão | Vazamento de segredo |
| 4 | Toda entrada externa passa por schema Zod antes de virar tipo | Dado inválido entra no domínio |
| 5 | Acesso a banco só por `withTenant` / `withoutTenant` | Isolamento entre escritórios cai |
| 6 | Mensagem exposta ao usuário nunca é a `message` do `DomainError` | Detalhe interno vaza pra tela |
| 7 | Regra de negócio mora em `packages/core`, não no controller | A regra fica presa ao HTTP |

---

## O papel da API

```
  navegador
     |  HTTP
     v
  apps/api        casca de entrega: rota, cookie, guard, tradução de erro
     |
     v
  packages/core   regra de negócio pura, sem I/O, sem NestJS
  packages/db     acesso ao Postgres, tenant context, migrações
```

A API não decide regra. Ela recebe, valida, chama o domínio e traduz o resultado (ou o erro) para HTTP.

---

## Estrutura de pastas

Uma pasta por área de negócio. Dentro dela, os arquivos falam o seu papel pelo sufixo.

```
  apps/api/src/
    main.ts                 abre a porta HTTP e só isso
    bootstrap.ts            config -> migrações -> cria o app (testável sem porta)
    app.module.ts           módulo raiz, monta os módulos filhos
    config/load-config.ts   valida process.env com Zod
    common/error.filter.ts  único ponto de tradução erro -> HTTP
    auth/
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      session.guard.ts
      role.guard.ts
      tenant-scope.interceptor.ts
      session.repository.ts
    health/
    identity/
    cli/                    comandos de operador, sem NestJS
```

| Sufixo | Responsabilidade | Tipo de teste |
| --- | --- | --- |
| `*.controller.ts` | HTTP: rota, status, cookie. Sem regra | e2e |
| `*.service.ts` | Orquestra domínio + repositório | integration |
| `*.repository.ts` | Query contra o esquema real | integration |
| `*.guard.ts` | Autenticação e autorização | e2e |
| `*.interceptor.ts` | Completa o contexto da requisição | e2e |
| `*.module.ts` | Só fiação. Sem lógica | — |

A tabela completa de cobertura está em `.specs/codebase/TESTING.md`.

### Módulo estático x dinâmico

Módulo sem configuração é estático:

```ts
@Module({
  controllers: [AuthController],
  providers: [AuthThrottle]
})
export class AuthModule {}
```

Módulo que precisa de valor vindo do boot usa `register(...)` e devolve `DynamicModule`. É assim que a config chega ao provider sem virar variável global:

```ts
@Module({})
export class HealthModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useFactory: () => new HealthService(databaseUrl) }
      ],
      exports: [HealthService]
    };
  }
}
```

Nada de `process.env` dentro de service ou controller. O env é lido uma vez em `loadConfig` e desce pela árvore de módulos.

---

## Injeção de dependência: `@Inject` é obrigatório

**A regra:** todo parâmetro de construtor tem `@Inject(Token)`. Nunca confie só no tipo.

```ts
// certo
constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

// errado — funciona no build, quebra em silêncio no teste
constructor(private readonly healthService: HealthService) {}
```

**Por que.** A injeção implícita do Nest lê a metadata `design:paramtypes`. Essa metadata só existe se o código passou pelo `tsc` de verdade, com `emitDecoratorMetadata` ligado. O Vitest transpila com esbuild, que não emite essa metadata.

```
  pnpm build (tsc)     -> design:paramtypes existe  -> injeção implícita funciona
  pnpm test (esbuild)  -> metadata ausente          -> parâmetro chega undefined
```

Pior parte: não estoura erro. O construtor recebe `undefined` e a falha aparece longe da causa. `@Inject` funciona igual nos dois transformers, então é o padrão único.

Descoberto na T11 do M0. Registrado também no `CLAUDE.md` e no `TESTING.md`.

Vale para qualquer coisa injetada, inclusive utilitários do próprio Nest:

```ts
constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
```

Classe sem dependência nenhuma (`SessionGuard`, `TenantScopeInterceptor`) não tem construtor — e aí não há o que anotar.

---

## Validação de entrada com Zod 4

Validação acontece **na borda**, e é explícita. O projeto não usa `ValidationPipe` nem DTO com decorator — o schema Zod vive em `packages/contracts` e é a mesma verdade para o backend e para o painel.

```ts
async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
  const parsed = loginRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ code: "VALIDATION_ERROR" });
  }
  const input = parsed.data;
  // ...
}
```

Regras:

- O parâmetro entra como `unknown`. Nunca tipar `@Body()` com o tipo final — isso é uma promessa que o TypeScript não checa em runtime.
- Sempre `safeParse`, nunca `parse`. Exceção crua do Zod não é resposta HTTP.
- O erro devolvido é genérico (`VALIDATION_ERROR`). Não devolvemos o `issues` do Zod: ele expõe o formato interno.
- Schema de request/response mora em `packages/contracts`. Schema de env mora em `apps/api/src/config`.

**Diferenças do Zod 4 que já usamos:**

| Zod 3 | Zod 4 (é o que vale aqui) |
| --- | --- |
| `z.string().url()` | `z.url("mensagem")` |
| `z.string().email()` | `z.email("mensagem")` |
| `{ required_error, invalid_type_error }` | `{ error: "mensagem" }` |
| `error.errors` | `error.issues` |

Exemplo real, em `config/load-config.ts`:

```ts
const configSchema = z.object({
  DATABASE_URL: z.url("DATABASE_URL precisa ser uma URL válida"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa ter ao menos 32 caracteres"),
  API_PORT: z.coerce.number({ error: "API_PORT precisa ser numérica" }).int().positive(),
  PROCESS_ROLE: z.enum(["api", "worker", "scheduler"])
});
```

Falha de config nomeia **todas** as variáveis com problema, e **nunca** o valor recebido — `SESSION_SECRET` e `DATABASE_URL` são segredo.

---

## Tratamento de erro

O domínio lança `DomainError` com um `code` estável. A borda traduz esse código para status HTTP e para uma frase em português.

```
  packages/core         apps/api/common/error.filter.ts          resposta
  -------------------   -------------------------------------    ---------------
  InvalidCredentials    INVALID_CREDENTIALS   -> 401             { code, message }
  NoMembership          NO_MEMBERSHIP         -> 403
  InsufficientRole      INSUFFICIENT_ROLE     -> 403
  LastOwner             LAST_OWNER_PROTECTED  -> 409
  RateLimited           RATE_LIMITED          -> 429
  WeakPassword          PASSWORD_TOO_WEAK     -> 400
  (qualquer outra)      INTERNAL_ERROR        -> 500
```

Duas mensagens, sempre:

| Onde | Para quem | Exemplo |
| --- | --- | --- |
| `DomainError.message` | log do servidor | descrição técnica |
| `DOMAIN_ERROR_MESSAGE[code]` | usuário final | "E-mail ou senha inválidos." |

O `ErrorFilter` é `@Catch()` sem argumento — pega tudo. Exceção que ele não reconhece vira sempre o mesmo envelope de 500, com o stack só no log. Isso é deliberado: erro de driver do Postgres costuma trazer a string de conexão dentro da mensagem, e ela nunca pode sair na resposta.

O registro é global, feito no `bootstrap.ts`:

```ts
app.useGlobalFilters(new ErrorFilter());
```

**Ao criar um `DomainError` novo:** adicione a classe em `packages/core/src/errors.ts` **e** as duas entradas no `error.filter.ts` (status e mensagem). Código sem entrada cai no default 400 com texto genérico — funciona, mas é meio caminho.

---

## Guards, interceptors e autorização

Ordem do pipeline do Nest — é isso que explica o desenho:

```
  request -> middleware -> GUARDS -> INTERCEPTORS (ida) -> pipes -> handler
                                                                      |
  response <- FILTERS <- INTERCEPTORS (volta) <------------------------
```

Guard roda **antes** de interceptor. Guard não pode contar com nada que um interceptor faria.

Peças:

| Peça | O que faz | O que não faz |
| --- | --- | --- |
| `SessionGuard` | Lê o cookie, resolve a sessão, põe `sessionId` + `userId` no request | Não olha tenant nem papel |
| `TenantScopeInterceptor` | Resolve o membership ativo e completa o contexto | Não autentica |
| `RoleGuard` | Resolve membership **e** compara o papel com o piso exigido | — |

`SessionGuard` responde 401 idêntico para cookie ausente, adulterado ou expirado. Nada de mensagem diferente por caso — isso é oráculo para quem ataca.

`RoleGuard` resolve o membership por conta própria justamente porque é guard e o interceptor ainda não rodou. O interceptor é idempotente: se achar `tenantId` já no contexto, não reconsulta.

Não aplique guard e interceptor soltos numa rota. Use os decorators compostos:

```ts
@Protected()                 // sessão válida + tenant resolvido
@RequireRole("admin")        // o acima + piso de papel (autossuficiente)
```

```ts
export function Protected(): ClassDecorator & MethodDecorator {
  return applyDecorators(UseGuards(SessionGuard), UseInterceptors(TenantScopeInterceptor));
}
```

Eles existem para que esquecer uma das peças numa rota nova não seja um erro fácil de cometer.

Três respostas distintas, três significados:

```
  401 UNAUTHORIZED       não sei quem você é
  403 NO_MEMBERSHIP      sei quem você é, mas você não pertence a nenhum escritório
  403 INSUFFICIENT_ROLE  você pertence, mas o seu papel não alcança essa ação
```

Comparação de papel usa `hasAtLeast` de `packages/core`. A hierarquia é regra de negócio; ela não vive no guard.

---

## Checklist para uma rota nova

```
  [ ] schema Zod do request/response em packages/contracts
  [ ] @Body() tipado como unknown + safeParse no controller
  [ ] @Protected() ou @RequireRole(...) aplicado
  [ ] @Inject(Token) em todo parâmetro de construtor
  [ ] regra de negócio em packages/core, não no controller
  [ ] DomainError novo -> entrada em DOMAIN_ERROR_STATUS e DOMAIN_ERROR_MESSAGE
  [ ] teste e2e cobrindo status, cookie e ordem de guard
  [ ] nenhuma mensagem carrega segredo
```

---

## Dívida de versão

**Onde estamos:** NestJS 10.4.22 · Express 4.22.1 no runtime · reflect-metadata 0.2.2 · rxjs 7.8 · Zod 4.5.4.

**Onde está o ecossistema:** NestJS 11 é a linha estável, com Express 5 por baixo.

| Item | Situação |
| --- | --- |
| Zod | ✅ em dia — migrado do 3 para o 4.5 |
| NestJS | ⚠️ uma major atrás |
| Express | ⚠️ **tipos e runtime desalinhados** |

### O desalinhamento do Express

`apps/api/package.json` declara `@types/express: ^5.0.0`, mas o `@nestjs/platform-express@10` traz o **Express 4.22.1** no runtime. Compilamos contra a tipagem de uma versão e executamos outra.

Hoje não dói porque o uso de Express é raso: `Request`, `Response`, `res.cookie`, `res.clearCookie`. Mas é armadilha silenciosa — o tipo diz uma coisa e o runtime faz outra. Alinhar `@types/express` para `^4` é correção barata e vale fazer **antes** da migração maior, para não misturar dois problemas.

### O que ganharíamos com o NestJS 11

| Ganho | Peso aqui |
| --- | --- |
| Express 5 no runtime, alinhando com os tipos já declarados | alto — resolve o desalinhamento |
| Suporte ativo (a linha 10 caminha para só correção de segurança) | alto |
| Melhorias de log e de resolução de módulo | baixo |

### O que a migração exigiria

| Ponto | Risco |
| --- | --- |
| `app.set("query parser", "extended")` — Express 5 troca o parser e para de entender objeto/array aninhado em query string | baixo: não usamos query aninhada hoje |
| Roteamento do Express 5 é mais estrito (wildcards, params) | baixo: rotas simples, sem wildcard |
| Bump coordenado de `@nestjs/common`, `core` e `platform-express` | baixo |
| `CacheModule` migrado para Keyv | nenhum: não usamos |
| `ConfigModule` com Joi | nenhum: config é Zod próprio |
| Suíte e2e inteira revalidada (cookie, status, ordem de guard) | médio: é o gate real da migração |

**Recomendação:** migrar, mas como task própria, não de carona em feature. Não é urgente — nada do M1 depende do Nest 11. Ficar na linha 10 depois do M2 vira dívida real.

---

## Referências

- NestJS — Custom providers e `@Inject`: https://docs.nestjs.com/fundamentals/custom-providers
- NestJS — Dependency injection (`useFactory`, `inject`): https://docs.nestjs.com/fundamentals/dependency-injection
- NestJS — Dynamic modules: https://docs.nestjs.com/fundamentals/dynamic-modules
- NestJS — Request lifecycle (ordem guard → interceptor → pipe → filter): https://docs.nestjs.com/faq/request-lifecycle
- NestJS — Migration guide v10 → v11: https://docs.nestjs.com/migration-guide
- Zod 4 — changelog e migração: https://zod.dev/v4/changelog
- Interno: `CLAUDE.md`, `.specs/codebase/TESTING.md`, `docs/adr/`

Documentação externa consultada via context7 (`/nestjs/docs.nestjs.com`) em 2026-09-06.
