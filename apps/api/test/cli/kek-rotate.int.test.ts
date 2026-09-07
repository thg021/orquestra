import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import {
  runMigrations,
  closeDefaultPool,
  withTenant,
  withoutTenant,
  identitySchema,
  serviceManagementSchema,
  insertConnectorConnection
} from "@orquestra/db";
import { createVault, loadKeks, type Vault } from "@orquestra/core";
import { runKekRotate } from "../../src/cli/commands/kek-rotate";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

let dir: string | undefined;

/** Cria o diretório de KEK só com a v1 — é o estado do mundo antes de rotacionar. */
function newKekDirWithV1(): string {
  dir = mkdtempSync(join(tmpdir(), "orquestra-kek-rotate-"));
  writeFileSync(join(dir, "1"), randomBytes(32));
  return dir;
}

/** Adiciona a v2 ao MESMO diretório — é o operador montando a KEK nova antes de rodar. */
function addV2ToDir(): void {
  if (!dir) throw new Error("dir não inicializado — chame newKekDirWithV1() primeiro");
  writeFileSync(join(dir, "2"), randomBytes(32));
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("kek:rotate", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    process.env.DATABASE_URL = db.appUrl;
  }, 180_000);

  afterAll(async () => {
    await closeDefaultPool();
    await db.close();
  });

  /**
   * `runKekRotate` varre TODO tenant com conexão pendente — sobra de um teste anterior
   * seria "achada" pelo próximo, selada sob uma KEK que o afterEach já apagou. Tenant
   * novo por teste não basta sozinho (tenants não têm FK de connector_connections);
   * é preciso truncar as duas tabelas entre testes.
   */
  afterEach(async () => {
    const client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
    try {
      await client.query("truncate table connector_connections, tenants restart identity cascade");
    } finally {
      await client.end();
    }
  });

  async function newTenant(): Promise<string> {
    const tenantId = randomUUID();
    await withoutTenant((tx) => tx.insert(identitySchema.tenants).values({ id: tenantId, name: "Tenant do teste" }));
    return tenantId;
  }

  /** Sela sob a v1 do diretório corrente. */
  async function seedConnection(tenantId: string, id: string, plaintext: string) {
    if (!dir) throw new Error("dir não inicializado — chame newKekDirWithV1() primeiro");
    const vaultV1Only = createVault(loadKeks(dir));
    const sealed = vaultV1Only.seal(tenantId, id, plaintext);

    await withTenant(tenantId, (tx) =>
      insertConnectorConnection(
        {
          id,
          tenantId,
          connectorKey: "platform-upload",
          name: id,
          secretEnvelope: sealed.secretEnvelope,
          dekEnvelope: sealed.dekEnvelope,
          keyVersion: sealed.keyVersion,
          last4: plaintext.slice(-4)
        },
        tx
      )
    );

    return sealed;
  }

  async function fetchConnection(tenantId: string, id: string) {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(serviceManagementSchema.connectorConnections)
        .where(eq(serviceManagementSchema.connectorConnections.id, id));
      return rows[0];
    });
  }

  it("interromper no meio deixa as duas versões convivendo, ambas legíveis", async () => {
    const tenantId = await newTenant();
    newKekDirWithV1();
    const idA = randomUUID();
    const idB = randomUUID();
    await seedConnection(tenantId, idA, "credencial-a-1234");
    await seedConnection(tenantId, idB, "credencial-b-5678");
    addV2ToDir();
    if (!dir) throw new Error("dir não inicializado");
    const kekDir = dir;

    let calls = 0;
    await runKekRotate(
      { toVersion: 2, kekDir },
      {
        createVaultFn: (keks) => {
          const real = createVault(keks);
          const wrapped: Vault = {
            ...real,
            rewrapDek(tenantIdArg, connectionIdArg, sealed, toVersion) {
              calls += 1;
              if (calls === 2) throw new Error("interrupção simulada");
              return real.rewrapDek(tenantIdArg, connectionIdArg, sealed, toVersion);
            }
          };
          return wrapped;
        }
      }
    ).catch((error: unknown) => error as Error);

    const rowA = await fetchConnection(tenantId, idA);
    const rowB = await fetchConnection(tenantId, idB);
    const versions = [rowA?.keyVersion, rowB?.keyVersion].sort();
    expect(versions).toEqual([1, 2]);

    const vaultBoth = createVault(loadKeks(kekDir));
    for (const row of [rowA, rowB]) {
      if (!row) throw new Error("linha não encontrada");
      const opened = vaultBoth.open(tenantId, row.id, {
        secretEnvelope: row.secretEnvelope,
        dekEnvelope: row.dekEnvelope,
        keyVersion: row.keyVersion,
        last4: row.last4
      });
      expect(opened.startsWith("credencial-")).toBe(true);
    }
  });

  it("rodar de novo conclui o trabalho que ficou pendente", async () => {
    const tenantId = await newTenant();
    newKekDirWithV1();
    const idA = randomUUID();
    const idB = randomUUID();
    await seedConnection(tenantId, idA, "credencial-c-1111");
    await seedConnection(tenantId, idB, "credencial-d-2222");
    addV2ToDir();
    if (!dir) throw new Error("dir não inicializado");
    const kekDir = dir;

    let calls = 0;
    await runKekRotate(
      { toVersion: 2, kekDir },
      {
        createVaultFn: (keks) => {
          const real = createVault(keks);
          return {
            ...real,
            rewrapDek(t, c, sealed, toVersion) {
              calls += 1;
              if (calls === 2) throw new Error("interrupção simulada");
              return real.rewrapDek(t, c, sealed, toVersion);
            }
          };
        }
      }
    ).catch(() => undefined);

    const result = await runKekRotate({ toVersion: 2, kekDir });

    expect(result.connectionsRewrapped).toBe(1);
    const rowA = await fetchConnection(tenantId, idA);
    const rowB = await fetchConnection(tenantId, idB);
    expect(rowA?.keyVersion).toBe(2);
    expect(rowB?.keyVersion).toBe(2);
  });

  it("rodar quando não há mais o que fazer é inofensivo", async () => {
    const tenantId = await newTenant();
    newKekDirWithV1();
    const id = randomUUID();
    await seedConnection(tenantId, id, "credencial-e-3333");
    addV2ToDir();
    if (!dir) throw new Error("dir não inicializado");
    const kekDir = dir;

    await runKekRotate({ toVersion: 2, kekDir });
    const afterFirst = await fetchConnection(tenantId, id);

    const second = await runKekRotate({ toVersion: 2, kekDir });
    const afterSecond = await fetchConnection(tenantId, id);

    expect(second.connectionsRewrapped).toBe(0);
    expect(afterSecond?.dekEnvelope.equals(afterFirst!.dekEnvelope)).toBe(true);
  });

  it("o secret_envelope nunca muda — a rotação nunca decifra o segredo em si", async () => {
    const tenantId = await newTenant();
    newKekDirWithV1();
    const id = randomUUID();
    const sealed = await seedConnection(tenantId, id, "credencial-f-4444");
    addV2ToDir();
    if (!dir) throw new Error("dir não inicializado");
    const kekDir = dir;

    await runKekRotate({ toVersion: 2, kekDir });

    const row = await fetchConnection(tenantId, id);
    expect(row?.secretEnvelope.equals(sealed.secretEnvelope)).toBe(true);
  });
});
