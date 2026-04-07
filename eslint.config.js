import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        project: [
          "./tsconfig.json",
          "./apps/web/tsconfig.json",
          "./packages/ui/tsconfig.json",
        ],
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
  },
]
