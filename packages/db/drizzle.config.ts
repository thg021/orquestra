import { defineConfig } from "drizzle-kit";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;

if (!migrationUrl) {
  throw new Error("DATABASE_MIGRATION_URL não definida — necessária para gerar/aplicar migrações.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./migrations",
  dbCredentials: {
    url: migrationUrl
  }
});
