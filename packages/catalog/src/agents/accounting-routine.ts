import { z } from "zod";
import { StateGraph, START, END } from "@langchain/langgraph";
import { defineAgent } from "../define";
import { CAPABILITIES } from "../capabilities";

// Capabilities de SAÍDA — as que coexistem e são escolhidas por destinatário (design
// §4). `file-storage` é entrada e fica de fora: um cliente não "recebe" por ela.
const OUTPUT_CAPABILITIES = CAPABILITIES.filter((c) => c !== "file-storage");
const outputCapabilitySchema = z.enum(OUTPUT_CAPABILITIES as [string, ...string[]]);

// Substitui `categorias` do clientes.yaml original. Nomes em inglês (D12: identificador
// é código), rótulo em português via .meta() para quando o CRUD existir.
const customerCategorySchema = z.enum(["hasEmployees", "noEmployees", "commerce"]);

const customerSchema = z.object({
  name: z.string().min(1).meta({ title: "Nome do cliente" }),
  categories: z.array(customerCategorySchema).min(1).meta({ title: "Categorias" }),
  // Um cliente pode ter mais de um contato, e cada contato usa o canal que corresponde
  // a uma capability de saída — é a mesma escolha "por destinatário" do design §4,
  // só que expressa dado a dado em vez de configuração da instância.
  contacts: z
    .array(
      z.object({
        channel: outputCapabilitySchema.meta({ title: "Canal" }),
        value: z.string().min(1).meta({ title: "Contato" })
      })
    )
    .min(1)
    .meta({ title: "Contatos" })
});

/**
 * Reescrita da skill `rotina-contabil` como serviço plugável (design §7) — não um
 * port. `caminho_base_local` do `clientes.yaml` não vira campo de configuração: virou
 * a capability `file-storage`, resolvida pela conexão que o escritório escolher. Os
 * tipos de documento por categoria (`tipos_documento`/`categorias_documentos`) também
 * não são configuráveis aqui — são regra de negócio fixa, extraída para código
 * testável no M4, não campo de formulário.
 *
 * O grafo de verdade (ler documento, conferir contra o cadastro, montar plano de
 * entrega) é regra de negócio do M4 (D41) — as regras hoje implícitas na skill
 * original ainda não viraram teste. Este é um placeholder de um nó só, só para o
 * catálogo ficar válido (GRA-01); T9 não decide nenhuma regra contábil.
 */
function buildPlaceholderGraph() {
  return new StateGraph(z.object({})).addNode("placeholder", async () => ({})).addEdge(START, "placeholder").addEdge("placeholder", END);
}
export const accountingRoutine = defineAgent({
  key: "accounting-routine",
  version: "1.0.0",
  title: "Rotina contábil",
  description:
    "Conferência de folha e fiscal x DAS, com envio de documentos e lembretes aos clientes conforme categoria.",
  configSchema: z.object({
    signature: z.string().min(1).meta({
      title: "Assinatura do escritório",
      description: "Usada no rodapé de todo e-mail enviado pela rotina."
    }),
    defaultDeadline: z.string().min(1).meta({
      title: "Prazo padrão",
      description: "Texto livre usado nos modelos de e-mail (ex.: \"todo dia 20\")."
    }),
    defaultCc: z.array(z.email()).meta({
      title: "Cópia padrão",
      description: "Endereços que recebem cópia de todo e-mail enviado pela rotina."
    })
  }),
  capabilities: [
    { capability: "file-storage", required: true },
    { capability: "email", required: true },
    { capability: "document-delivery", required: false },
    { capability: "messaging", required: false }
  ],
  dataCollections: [
    {
      key: "customers",
      schema: customerSchema
    }
  ],
  graph: buildPlaceholderGraph
});
