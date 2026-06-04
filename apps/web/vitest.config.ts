import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // .tsx 用于需要 React 渲染的 hook/集成测试（按文件用 `// @vitest-environment happy-dom`）
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
