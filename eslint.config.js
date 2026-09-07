// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.config.js",
      "**/*.config.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    rules: {
      "import/no-relative-packages": "error"
    }
  },
  {
    files: ["apps/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/packages/*/src/*", "../../packages/*/src/*"],
              message:
                "Importe pacotes pelo nome do workspace (@orquestra/x), nunca por caminho relativo para dentro de packages/*/src."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["packages/core/**/*.ts", "packages/db/**/*.ts", "packages/catalog/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@nestjs/*"],
              message:
                "packages/core, packages/db e packages/catalog são domínio, persistência e declaração puros — não podem depender do NestJS."
            }
          ]
        }
      ]
    }
  },
  prettier
);
