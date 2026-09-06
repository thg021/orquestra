import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";

/**
 * Pool próprio, independente do de packages/db: health é uma checagem de
 * infraestrutura (SELECT 1), não um acesso a dado de tenant — não precisa (e não deve)
 * passar pela disciplina de withTenant/withoutTenant.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private migrationsApplied = false;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 1 });
  }

  markMigrationsApplied(): void {
    this.migrationsApplied = true;
  }

  isLive(): boolean {
    return true;
  }

  /**
   * Pronto só depois das migrações aplicadas no boot, e só se o Postgres responde
   * agora — não mascara um banco que caiu depois que o processo já estava de pé.
   */
  async isReady(): Promise<boolean> {
    if (!this.migrationsApplied) {
      return false;
    }
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
