import path from "path"
import pkg from "./package.json"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import electron from "vite-plugin-electron"
import renderer from "vite-plugin-electron-renderer"
import { defineConfig, loadEnv, type ConfigEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ command, mode }: ConfigEnv) => {
  const env = loadEnv(mode, process.cwd())
  const isServe = command === "serve"
  const isBuild = command === "build"
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG
  const server_url = `${env.VITE_BACKEND_URL}:${env.VITE_BACKEND_PORT}`

  const mainBundledDeps = new Set(["electron-store", "jszip"])

  const preloadExternal = Object.keys(
    "dependencies" in pkg ? pkg.dependencies : {}
  ).filter(
    (dep) => !mainBundledDeps.has(dep) && dep !== "@electron-toolkit/preload"
  )

  /** 单入口 preload，避免多 input 拆 chunk 导致 index.mjs 引用缺失的 ./preload.mjs */
  function electronPreloadBuild(input: string, outputFile: string) {
    return {
      vite: {
        build: {
          sourcemap: sourcemap ? ("inline" as const) : undefined,
          minify: isBuild,
          outDir: "dist-electron/preload",
          // 不可 emptyOutDir：index 热更新会清空目录并删掉 extension-preload.mjs
          emptyOutDir: false,
          rollupOptions: {
            input,
            external: preloadExternal,
            output: {
              format: "cjs" as const,
              inlineDynamicImports: true,
              entryFileNames: outputFile,
            },
          },
        },
      },
      onstart(args: { reload: () => void }) {
        args.reload()
      },
    }
  }

  return {
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      ...(mode === "electron"
        ? [
            electron([
              {
                entry: "electron/main/index.ts",
                onstart({ startup }) {
                  if (process.env.VSCODE_DEBUG) {
                    console.log(
                      /* For `.vscode/.debug.script.mjs` */ "[startup] Electron App"
                    )
                  } else {
                    startup()
                  }
                },
                vite: {
                  build: {
                    sourcemap,
                    minify: isBuild,
                    outDir: "dist-electron/main",
                    rollupOptions: {
                      external: Object.keys(
                        "dependencies" in pkg ? pkg.dependencies : {}
                      ).filter((dep) => !mainBundledDeps.has(dep)),
                    },
                  },
                },
              },
              electronPreloadBuild("electron/preload/index.ts", "index.mjs"),
              electronPreloadBuild(
                "electron/preload/extension-preload.ts",
                "extension-preload.mjs"
              ),
            ]),
            renderer(),
          ]
        : []),
    ],
    base: "./",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    optimizeDeps: {
      include: [
        "@kandiforge/pptx-renderer",
        "@mui/material",
        "@mui/icons-material",
        "@emotion/react",
        "@emotion/styled",
        "docx-preview",
        "xlsx",
        // mermaid(被 streamdown 打包、且 streamdown 在 exclude 里)内部 `import dayjs from 'dayjs'`，
        // dayjs 是 CJS/UMD；显式预打包它，提供带 default 的 ESM 互操作，修
        // "dayjs ... does not provide an export named 'default'"。
        "dayjs",
      ],
      // streamdown 内部 lazy import 代码高亮 chunk；预构建后 hash 易与 HMR/缓存不同步
      exclude: [
        "streamdown",
        "@streamdown/code",
        "@streamdown/cjk",
        "@streamdown/math",
        "@streamdown/mermaid",
      ],
    },
    server: {
      port: 3399,
      host: "0.0.0.0",
      open: false,
      proxy: {
        "/actus": {
          target: server_url,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/actus/, ""),
          /** 与后端 LangGraph+LLM /chat/send 等长请求对齐，避免开发代理提前断开 */
          timeout: 180_000,
          proxyTimeout: 180_000,
        },
        "/digital": {
          target: "http://10.172.246.179:5002",
          changeOrigin: true,
        },
      },
    },
  }
})
