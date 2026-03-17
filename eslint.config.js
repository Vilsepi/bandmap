import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`^\.{1,2}/(?!.*\.[a-z0-9]+$).+`,
              message:
                "Use explicit file extensions for relative ESM imports. For TypeScript modules, import the emitted .js path.",
            },
            {
              regex: String.raw`^\.{1,2}/.*\.ts$`,
              message:
                "Do not import TypeScript source files directly from ESM code. Import the emitted .js path instead.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores(["**/dist/", "**/node_modules/", "**/cdk.out/", "packages/web/vite.config.ts", "packages/infra/cdk.json"]),
);
