/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: 'true'
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬ dist-electron
     * │ ├─┬ main
     * │ │ └── index.js    > Electron-Main
     * │ └─┬ preload
     * │   ├── index.mjs
     * │   └── extension-preload.mjs
     * ├─┬ dist
     * │ └── index.html    > Electron-Renderer
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
    /** 品牌目录覆盖（指向含 brand.json 的目录）；见 features/branding。 */
    DE_BRANDING_DIR?: string
  }
}

import type { ResolvedBrand } from "./shared/brand"

declare global {
  interface Window {
    /** preload 注入的已解析品牌；非 Electron 环境为 undefined。 */
    brand?: ResolvedBrand
  }
}
