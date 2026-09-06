# Orquestra

**Vision:** Plataforma multitenant onde automações de negócio são montadas plugando agentes (o quê fazer) e conectores (com o quê integrar), cada combinação instalada num tenant como um sistema próprio, com ciclo de vida, dados e observabilidade isolados.
**For:** Operadores de processos recorrentes e intensivos em documento — o piloto é um escritório contábil; o modelo é horizontal por construção.
**Solves:** Automações desse tipo hoje vivem como scripts ou prompts avulsos presos a uma máquina e a uma pessoa. Não são multiusuário, não têm trilha de auditoria, não têm gate de aprovação confiável antes de ações irreversíveis, e cada nova integração exige reescrever a automação.

## Goals

- **Provar o modelo plugável com uso real:** a rotina contábil hoje implementada como skill markdown roda inteiramente pela plataforma, agendada, por um tenant real — a skill avulsa deixa de ser usada.
- **Isolamento de tenant garantido pelo banco, não pela disciplina do desenvolvedor:** teste automatizado prova que, sob o contexto do tenant A, nenhuma linha do tenant B é legível em qualquer tabela com RLS.
- **Nenhum efeito colateral externo sem aprovação humana:** teste automatizado prova que o grafo interrompe e nenhum adapter de envio é chamado antes da decisão.
- **Nova integração sem tocar no agente:** adicionar um conector de uma capability existente não altera nenhum arquivo de agente.

## Tech Stack

**Core:**

- Linguagem: TypeScript
- Backend: NestJS (papéis `api`, `worker`, `scheduler` a partir da mesma imagem)
- Frontend: React
- Banco: PostgreSQL com Row-Level Security

**Key dependencies:** LangGraph (grafos de agente, checkpoint e interrupt), BullMQ + Redis (filas), OpenRouter (gateway de LLM), Docker Compose (orquestração em host único), pnpm workspaces (monorepo)

## Scope

**v1 includes:**

- Multitenancy com isolamento no banco via `tenant_id` + RLS
- Catálogo de agentes e de conectores, combináveis independentemente
- Ciclo de vida de service instances (instalar / ativar / pausar / remover)
- Configuração por instância dirigida por JSON Schema
- Credenciais de conector autenticadas uma vez por tenant, reutilizáveis entre serviços, cifradas em repouso
- Execução assíncrona e agendada de grafos de agente
- Aprovação humana como primitiva do runtime
- Observabilidade por execução com contabilidade de custo de LLM
- Painel React de administração e observabilidade
- Agente `accounting-routine` (migração da skill `rotina-contabil`)
- Conectores `gmail`, `onedrive`, `whatsapp` (via MCP) e `fortes-conecta`

**Explicitly out of scope:**

- Chat com agentes (superfície com desenho próprio; spec separado pós-MVP)
- Billing e planos (custo é contabilizado, mas não cobrado)
- Marketplace de terceiros — todo agente e conector é código do operador, portanto sem sandboxing
- Kubernetes — o alvo é Docker Compose em host único
- Segundo tenant real — a arquitetura suporta, mas um tenant basta para validar

## Constraints

- **Técnica — acesso a arquivos:** a conta Microsoft do tenant piloto é pessoal (Outlook.com), o que já inviabilizou o conector M365 antes. O acesso via Graph API precisa ser provado cedo; o fallback é um agente-ponte local atrás do mesmo `FileStoragePort`.
- **Técnica — Fortes Conecta:** existe API REST oficial com chaves já em posse do operador. A cobertura dela sobre o fluxo de protocolo digital precisa ser validada antes de descartar alternativas.
- **De produto:** a skill `rotina-contabil` e seus `references/` são a especificação de origem do agente contábil. Cada regra migrada vira teste antes de virar código — a reescrita não pode perder comportamento que hoje só existe na interpretação do agente.
- **Recursos:** desenvolvedor único. Fases precisam ser entregáveis verificáveis de forma independente.

## Referências

- Design arquitetural completo: `docs/specs/2026-09-05-orquestra-design.md`
- Especificação de origem do agente contábil: skill `rotina-contabil` em `C:/Users/thiago.silva/projects/escritorio/.claude/skills/rotina-contabil/`
