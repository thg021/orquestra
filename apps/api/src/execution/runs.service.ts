import { ConflictException } from "@nestjs/common";
import { withTenant, insertServiceRun, findServiceRunById, type ServiceRunRow } from "@orquestra/db";
import { newId } from "@orquestra/core";
import { getServiceInstance } from "../service-instances/service-instances.service";
import type { RunQueueClient } from "./queue";
import { ServiceRunNotFoundError } from "./errors";

async function getServiceRun(tenantId: string, id: string): Promise<ServiceRunRow> {
  const found = await withTenant(tenantId, (tx) => findServiceRunById(id, tx));
  if (!found) {
    throw new ServiceRunNotFoundError(id);
  }
  return found;
}

/** Só uma instância `active` dispara — qualquer outro status é 409 nomeando o status atual (RUN-03). */
export async function triggerManualRun(
  tenantId: string,
  serviceInstanceId: string,
  runQueue: RunQueueClient
): Promise<ServiceRunRow> {
  const instance = await getServiceInstance(tenantId, serviceInstanceId);
  if (instance.status !== "active") {
    throw new ConflictException({
      code: "INSTANCE_NOT_ACTIVE",
      message: `Instância está em status "${instance.status}"; só uma instância "active" pode disparar execução.`
    });
  }

  const runId = newId();
  await withTenant(tenantId, (tx) =>
    insertServiceRun({ id: runId, tenantId, serviceInstanceId, trigger: "manual" }, tx)
  );
  await runQueue.enqueue({ tenantId, serviceInstanceId, runId, trigger: "manual" });

  return getServiceRun(tenantId, runId);
}
