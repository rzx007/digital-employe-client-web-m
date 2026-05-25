import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 允许与组件同文件导出工具函数/常量（Vite HMR 可接受；插件默认仅放行 primitive 常量）
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/stores/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
    ],
    ignores: ["src/lib/chat/chat-mappers.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/api/types",
              importNames: ["ChatMessageDto", "ConversationListItemDto"],
              message:
                "UI 层使用 @/types/chat（Message、Conversation），勿直接引用 API DTO。",
            },
            {
              name: "@/api/conversation",
              message:
                "请从 @/api/chat facade 导入，勿直连 api/conversation。",
            },
          ],
        },
      ],
    },
  },
])
