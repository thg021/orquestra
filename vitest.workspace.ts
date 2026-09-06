import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["{apps/api,packages}/**/*.unit.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      environment: "node",
      passWithNoTests: true
    }
  },
  {
    test: {
      name: "unit:web",
      include: ["apps/web/**/*.unit.test.tsx", "apps/web/**/*.unit.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      environment: "jsdom",
      passWithNoTests: true
    }
  },
  {
    test: {
      name: "integration",
      include: ["{apps,packages}/**/*.int.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      environment: "node",
      // testes de integração tocam Postgres real via Testcontainers; não paralelizam entre arquivos
      // para evitar exaustão de containers na máquina de desenvolvimento.
      fileParallelism: false,
      passWithNoTests: true
    }
  },
  {
    test: {
      name: "e2e",
      include: ["{apps,packages}/**/*.e2e.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      environment: "node",
      fileParallelism: false,
      passWithNoTests: true
    }
  }
]);
