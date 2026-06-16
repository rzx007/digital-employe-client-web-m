import fs from "node:fs"
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
  // CI/打包环境通常没有 .env（被 gitignore），缺失时从 .env.example 兜底，
  // 否则 import.meta.env.VITE_* 全为 undefined（后端地址会变成 undefined:undefined）。
  const envFile = path.resolve(__dirname, ".env")
  const envExample = path.resolve(__dirname, ".env.example")
  if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile)
  }
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
