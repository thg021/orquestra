import { and, eq, inArray } from "drizzle-orm";
import { deliveryReceipts } from "../schema/execution";
import type { Tx } from "../tenant-context";

export interface InsertDeliveryReceiptInput {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  idempotencyKey: string;
  runId: string;
}

export class DuplicateDeliveryError extends Error {
  constructor(idempotencyKey: string) {
    super(`Já existe um recibo de entrega para a chave "${idempotencyKey}" nesta instância.`);
    this.name = "DuplicateDeliveryError";
  }
}

/**
 * Recibo só nasce de sucesso (design §Fluxos) — quem chama insere depois de entregar,
 * nunca antes. A unicidade é do banco (T1), então uma corrida entre duas execuções do
 * mesmo plano nunca produz dois recibos para a mesma chave (DEL-05).
 */
export async function insertDeliveryReceipt(input: InsertDeliveryReceiptInput, tx: Tx): Promise<void> {
  try {
    await tx.insert(deliveryReceipts).values({
      id: input.id,
      tenantId: input.tenantId,
      serviceInstanceId: input.serviceInstanceId,
      idempotencyKey: input.idempotencyKey,
      runId: input.runId
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateDeliveryError(input.idempotencyKey);
    }
    throw error;
  }
}

/** Quais destas chaves já têm recibo — é o que o executor de entrega consulta antes de tentar um item (DEL-05, T18). */
export async function findDeliveryReceipts(
  serviceInstanceId: string,
  idempotencyKeys: string[],
  tx: Tx
): Promise<string[]> {
  if (idempotencyKeys.length === 0) return [];
  const rows = await tx
    .select({ idempotencyKey: deliveryReceipts.idempotencyKey })
    .from(deliveryReceipts)
    .where(
      and(
        eq(deliveryReceipts.serviceInstanceId, serviceInstanceId),
        inArray(deliveryReceipts.idempotencyKey, idempotencyKeys)
      )
    );
  return rows.map((row) => row.idempotencyKey);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";
}
