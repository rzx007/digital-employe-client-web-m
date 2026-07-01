# 品牌元素包 / 白标化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工程人员只替换 `branding/` 文件夹里的 png + `brand.json` 文字即可产出不同品牌版本（如国网版），无需改代码/重打包；主题色与背景色做成 app 内置预设由用户在设置里切换。

**Architecture:** 两套独立机制。(A) 品牌资源包：Electron 主进程启动时从外置目录加载 `brand.json` 与 logo（读成 base64 data URL），经 preload 同步注入 `window.brand`，renderer 与主进程都改读它，去掉散落硬编码。(B) 主题/背景色：`globals.css` 加预设块，按 `data-brand-theme` 切换，设置页选择 + localStorage 持久化。

**Tech Stack:** Electron(main/preload) + React 19 + TanStack Router + Tailwind v4 (oklch CSS 变量) + vitest。

设计依据：[2026-06-29-branding-package-design.md](../specs/2026-06-29-branding-package-design.md)。

---

## File Structure

新增：
- `apps/web/electron/shared/brand.ts` — `ResolvedBrand` 类型 + 默认值常量（main/preload/renderer 共用类型）。
- `apps/web/electron/features/branding/brand-config.ts` — 目录解析 + 加载 + 逐项 default 合并 + 图片转 data URL。
- `apps/web/electron/features/branding/brand-config.test.ts` — 解析/回退/{year} 单测。
- `apps/web/electron/features/branding/ipc.ts` — 同步 IPC `brand:get-sync`。
- `apps/web/branding/default/brand.json` + `logo.png`/`login-logo.png`/`splash.png`（拷现资源）。
- `apps/web/branding/guowang/brand.json` + 占位图（国网示例样板）。
- `apps/web/branding/README.md` — 工程人员「如何做新品牌版本」说明。
- `apps/web/src/lib/brand/brand.ts` — renderer 端 `getBrand()` + `useBrand()` + `{year}` 替换。
- `apps/web/src/lib/brand/brand.test.ts` — `{year}` 替换 + web 兜底单测。
- `apps/web/src/lib/brand/brand-theme.ts` — 预设表 + `applyBrandTheme()` + 持久化。
- `apps/web/src/lib/brand/brand-theme.test.ts` — 预设应用/持久化单测。
- `scripts/activation/deploy.sh.branding.patch.md` — deploy.sh 增加品牌目录拷贝步骤的补丁说明。

修改：
- `apps/web/electron/preload/index.ts` — 注入 `window.brand`。
- `apps/web/electron/main/app-product.ts` — `APP_DISPLAY_NAME` 从 brand 取。
- 主进程窗口标题 / splash（创建窗口处）。
- `apps/web/electron-builder.json5` + `electron-builder.offline.json5` — `extraResources` 加 `branding`。
- `apps/web/packages/ui/src/styles/globals.css`（实际 `packages/ui/src/styles/globals.css`）— 主题预设块。
- `apps/web/src/main.tsx` — 启动套用 brand-theme。
- `apps/web/src/components/settings/general-settings.tsx` — 加「主题色」选择卡片。
- renderer 品牌字样去硬编码：`about-settings.tsx`、`login.tsx`、`register.tsx`、`recruitment-page.tsx`、`app-titlebar.tsx`、`curator-empty-welcome.tsx` 等。
- `apps/web/index.html` — `<title>` 改通用占位。

---

## Task 1: 共享品牌类型与默认值

**Files:**
- Create: `apps/web/electron/shared/brand.ts`

- [ ] **Step 1: 定义类型与默认值**

```typescript
// apps/web/electron/shared/brand.ts
/** 已解析品牌（logo 字段为 data URL 字符串）。main/preload/renderer 共用。 */
export interface ResolvedBrand {
  productName: string
  windowTitle: string
  subtitle: string
  companyName: string
  /** 可含 {year} 占位，渲染时替换为当前年 */
  copyright: string
  logos: { app: string; login: string; splash: string }
  /** 可选：品牌默认主题色预设 id（见 brand-theme.ts） */
  defaultTheme?: string
}

/** brand.json 原始结构（logo 为相对文件名）。 */
export interface BrandManifest {
  productName?: string
  windowTitle?: string
  subtitle?: string
  companyName?: string
  copyright?: string
  logos?: { app?: string; login?: string; splash?: string }
  defaultTheme?: string
}

/** 兜底默认（对齐现 BobanStaff 标识）。logo 为空串，renderer/main 各自补默认图。 */
export const DEFAULT_BRAND: ResolvedBrand = {
  productName: "数字员工",
  windowTitle: "BobanStaff",
  subtitle: "数字员工智能助手",
  companyName: "Bobandata",
  copyright: "© {year} Bobandata. All rights reserved.",
  logos: { app: "", login: "", splash: "" },
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/electron/shared/brand.ts
git commit -m "feat(branding): add shared ResolvedBrand types and defaults"
```

---

## Task 2: 主进程品牌加载 brand-config（TDD）

**Files:**
- Create: `apps/web/electron/features/branding/brand-config.ts`
- Test: `apps/web/electron/features/branding/brand-config.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/electron/features/branding/brand-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadBrandFromDir, substituteYear } from "./brand-config"

describe("brand-config", () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "brand-")) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it("逐项回退缺失字段到 default", () => {
    writeFileSync(join(dir, "brand.json"), JSON.stringify({ productName: "国网数字员工" }))
    const b = loadBrandFromDir(dir)
    expect(b.productName).toBe("国网数字员工")
    expect(b.companyName).toBe("Bobandata") // 回退 default
  })

  it("brand.json 损坏时整体回退 default", () => {
    writeFileSync(join(dir, "brand.json"), "{ not json")
    const b = loadBrandFromDir(dir)
    expect(b.productName).toBe("数字员工")
  })

  it("logo 文件存在则读成 data URL", () => {
    writeFileSync(join(dir, "brand.json"), JSON.stringify({ logos: { app: "a.png" } }))
    writeFileSync(join(dir, "a.png"), Buffer.from([1, 2, 3]))
    const b = loadBrandFromDir(dir)
    expect(b.logos.app.startsWith("data:image/png;base64,")).toBe(true)
  })

  it("substituteYear 替换 {year}", () => {
    expect(substituteYear("© {year} X", 2026)).toBe("© 2026 X")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web exec vitest run electron/features/branding/brand-config.test.ts`
Expected: FAIL（模块/函数未定义）

- [ ] **Step 3: 实现**

```typescript
// apps/web/electron/features/branding/brand-config.ts
import { existsSync, readFileSync } from "node:fs"
import { extname, isAbsolute, join } from "node:path"
import type { BrandManifest, ResolvedBrand } from "../../shared/brand"
import { DEFAULT_BRAND } from "../../shared/brand"

const MIME: Record<string, string> = {
  ".png": "image/png", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
}

function fileToDataUrl(path: string): string {
  const mime = MIME[extname(path).toLowerCase()] ?? "application/octet-stream"
  const b64 = readFileSync(path).toString("base64")
  return `data:${mime};base64,${b64}`
}

function readLogo(dir: string, name: string | undefined): string {
  if (!name) return ""
  const p = isAbsolute(name) ? name : join(dir, name)
  return existsSync(p) ? fileToDataUrl(p) : ""
}

export function substituteYear(s: string, year: number): string {
  return s.replace(/\{year\}/g, String(year))
}

/** 从指定目录读 brand.json + logo，逐项回退 DEFAULT_BRAND。损坏/缺失整体回退。 */
export function loadBrandFromDir(dir: string): ResolvedBrand {
  let m: BrandManifest = {}
  const jsonPath = join(dir, "brand.json")
  if (existsSync(jsonPath)) {
    try {
      m = JSON.parse(readFileSync(jsonPath, "utf-8")) as BrandManifest
    } catch {
      m = {}
    }
  }
  return {
    productName: m.productName ?? DEFAULT_BRAND.productName,
    windowTitle: m.windowTitle ?? DEFAULT_BRAND.windowTitle,
    subtitle: m.subtitle ?? DEFAULT_BRAND.subtitle,
    companyName: m.companyName ?? DEFAULT_BRAND.companyName,
    copyright: m.copyright ?? DEFAULT_BRAND.copyright,
    logos: {
      app: readLogo(dir, m.logos?.app),
      login: readLogo(dir, m.logos?.login) || readLogo(dir, m.logos?.app),
      splash: readLogo(dir, m.logos?.splash) || readLogo(dir, m.logos?.app),
    },
    defaultTheme: m.defaultTheme,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web exec vitest run electron/features/branding/brand-config.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/electron/features/branding/brand-config.ts apps/web/electron/features/branding/brand-config.test.ts
git commit -m "feat(branding): load brand.json + logos with per-field fallback"
```

---

## Task 3: 目录解析 resolveBrandingDir + 缓存 getResolvedBrand

**Files:**
- Modify: `apps/web/electron/features/branding/brand-config.ts`

- [ ] **Step 1: 追加解析顺序与缓存（无独立测试，逻辑薄）**

在 `brand-config.ts` 末尾追加：

```typescript
import { app } from "electron"

/** 解析顺序：DE_BRANDING_DIR > <resources>/branding/active > 打包内 default。 */
export function resolveBrandingDir(): string {
  const env = process.env.DE_BRANDING_DIR
  if (env && existsSync(join(env, "brand.json"))) return env
  const active = join(process.resourcesPath ?? "", "branding", "active")
  if (existsSync(join(active, "brand.json"))) return active
  // 开发态 / 兜底：仓库内 default
  const builtin = app?.isPackaged
    ? join(process.resourcesPath ?? "", "branding", "default")
    : join(app?.getAppPath?.() ?? process.cwd(), "branding", "default")
  return builtin
}

let cached: ResolvedBrand | null = null
export function getResolvedBrand(): ResolvedBrand {
  if (cached) return cached
  cached = loadBrandFromDir(resolveBrandingDir())
  return cached
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter web typecheck`
Expected: 通过（无类型错误）

- [ ] **Step 3: 提交**

```bash
git add apps/web/electron/features/branding/brand-config.ts
git commit -m "feat(branding): resolve branding dir with env/active/default order + cache"
```

---

## Task 4: 同步 IPC + preload 注入 window.brand

**Files:**
- Create: `apps/web/electron/features/branding/ipc.ts`
- Modify: `apps/web/electron/preload/index.ts`
- Modify: `apps/web/electron/electron-env.d.ts`（声明 window.brand 类型）

- [ ] **Step 1: 注册同步 IPC**

```typescript
// apps/web/electron/features/branding/ipc.ts
import { ipcMain } from "electron"
import { getResolvedBrand } from "./brand-config"

/** 在 app ready、创建任何窗口前调用。sendSync 让 preload 同步拿到品牌、首帧不闪。 */
export function registerBrandingIpc(): void {
  ipcMain.on("brand:get-sync", (event) => {
    event.returnValue = getResolvedBrand()
  })
}
```

- [ ] **Step 2: preload 注入**

在 `apps/web/electron/preload/index.ts`，`import` 区加 `import { ipcRenderer } from "electron"`（若未引入），并在两个分支都注入 brand：

```typescript
const brand = ipcRenderer.sendSync("brand:get-sync")
// contextIsolated 分支：
contextBridge.exposeInMainWorld("brand", brand)
// 非隔离分支：
window.brand = brand
```

- [ ] **Step 3: 类型声明**

在 `apps/web/electron/electron-env.d.ts` 末尾追加：

```typescript
import type { ResolvedBrand } from "./shared/brand"
declare global {
  interface Window {
    brand?: ResolvedBrand
  }
}
```

- [ ] **Step 4: 在 bootstrap 注册（app ready 后、建窗前）**

找到主进程启动序列（`electron/core/bootstrap.ts`），在创建窗口前调用 `registerBrandingIpc()`：

```typescript
import { registerBrandingIpc } from "../features/branding/ipc"
// app.whenReady() 之后、第一个 createWindow 之前：
registerBrandingIpc()
```

- [ ] **Step 5: typecheck**

Run: `pnpm --filter web typecheck`
Expected: 通过

- [ ] **Step 6: 提交**

```bash
git add apps/web/electron/features/branding/ipc.ts apps/web/electron/preload/index.ts apps/web/electron/electron-env.d.ts apps/web/electron/core/bootstrap.ts
git commit -m "feat(branding): expose resolved brand to renderer via sync IPC + preload"
```

---

## Task 5: renderer 端 getBrand/useBrand（TDD）

**Files:**
- Create: `apps/web/src/lib/brand/brand.ts`
- Create: `apps/web/src/lib/brand/default-brand.ts`
- Test: `apps/web/src/lib/brand/brand.test.ts`

- [ ] **Step 1: web 兜底默认**

```typescript
// apps/web/src/lib/brand/default-brand.ts
import type { ResolvedBrand } from "@/../electron/shared/brand"
import defaultLogo from "@/assets/logo.png"

/** 非 Electron（web/dev）兜底品牌。logo 用打包进的默认图。 */
export const WEB_DEFAULT_BRAND: ResolvedBrand = {
  productName: "数字员工",
  windowTitle: "BobanStaff",
  subtitle: "数字员工智能助手",
  companyName: "Bobandata",
  copyright: "© {year} Bobandata. All rights reserved.",
  logos: { app: defaultLogo, login: defaultLogo, splash: defaultLogo },
}
```

> 若 `@/../electron/shared/brand` 路径别名不通，改为相对路径或在 `src/lib/brand/brand.ts` 内重声明同名 interface。执行时以 typecheck 为准。

- [ ] **Step 2: 写失败测试**

```typescript
// apps/web/src/lib/brand/brand.test.ts
import { describe, it, expect } from "vitest"
import { withYear } from "./brand"

describe("brand", () => {
  it("withYear 替换 {year} 为当前年", () => {
    const y = new Date().getFullYear()
    expect(withYear("© {year} X")).toBe(`© ${y} X`)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter web exec vitest run src/lib/brand/brand.test.ts`
Expected: FAIL（withYear 未定义）

- [ ] **Step 4: 实现**

```typescript
// apps/web/src/lib/brand/brand.ts
import * as React from "react"
import type { ResolvedBrand } from "@/../electron/shared/brand"
import { WEB_DEFAULT_BRAND } from "./default-brand"

/** Electron 下读 preload 注入的 window.brand，否则用 web 兜底。 */
export function getBrand(): ResolvedBrand {
  const injected = (window as Window & { brand?: ResolvedBrand }).brand
  return injected ?? WEB_DEFAULT_BRAND
}

export function withYear(s: string): string {
  return s.replace(/\{year\}/g, String(new Date().getFullYear()))
}

/** 组件里用：品牌是启动即定的常量，无需 context。 */
export function useBrand(): ResolvedBrand {
  return React.useMemo(() => getBrand(), [])
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter web exec vitest run src/lib/brand/brand.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/brand/
git commit -m "feat(branding): renderer getBrand/useBrand with web fallback"
```

---

## Task 6: 主题色预设 brand-theme（TDD）

**Files:**
- Create: `apps/web/src/lib/brand/brand-theme.ts`
- Test: `apps/web/src/lib/brand/brand-theme.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/lib/brand/brand-theme.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { applyBrandTheme, getStoredBrandTheme, BRAND_THEMES, BRAND_THEME_STORAGE_KEY } from "./brand-theme"

describe("brand-theme", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-brand-theme")
  })

  it("有 default、green 预设", () => {
    expect(BRAND_THEMES.map((t) => t.id)).toContain("green")
    expect(BRAND_THEMES.map((t) => t.id)).toContain("default")
  })

  it("apply 写 data-brand-theme 与 localStorage", () => {
    applyBrandTheme("green")
    expect(document.documentElement.getAttribute("data-brand-theme")).toBe("green")
    expect(localStorage.getItem(BRAND_THEME_STORAGE_KEY)).toBe("green")
  })

  it("default 不写属性（用根变量）", () => {
    applyBrandTheme("default")
    expect(document.documentElement.getAttribute("data-brand-theme")).toBe(null)
  })

  it("getStored 回退 default", () => {
    expect(getStoredBrandTheme()).toBe("default")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web exec vitest run src/lib/brand/brand-theme.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// apps/web/src/lib/brand/brand-theme.ts
export const BRAND_THEME_STORAGE_KEY = "brand-theme"

export interface BrandThemeOption {
  id: string
  label: string
  description: string
  /** 预览色块（oklch/hex 均可） */
  swatch: string
}

export const BRAND_THEMES: BrandThemeOption[] = [
  { id: "default", label: "靛蓝（默认）", description: "默认品牌色", swatch: "oklch(0.488 0.243 264.376)" },
  { id: "green", label: "国网绿", description: "国家电网风格", swatch: "oklch(0.55 0.13 155)" },
  { id: "teal", label: "青蓝", description: "清爽青蓝", swatch: "oklch(0.6 0.12 200)" },
]

const VALID = new Set(BRAND_THEMES.map((t) => t.id))

export function getStoredBrandTheme(): string {
  const v = localStorage.getItem(BRAND_THEME_STORAGE_KEY)
  return v && VALID.has(v) ? v : "default"
}

/** 应用预设：default 清属性（走 :root 根变量），其余写 data-brand-theme。 */
export function applyBrandTheme(id: string): void {
  const next = VALID.has(id) ? id : "default"
  localStorage.setItem(BRAND_THEME_STORAGE_KEY, next)
  const root = document.documentElement
  if (next === "default") root.removeAttribute("data-brand-theme")
  else root.setAttribute("data-brand-theme", next)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web exec vitest run src/lib/brand/brand-theme.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/brand/brand-theme.ts apps/web/src/lib/brand/brand-theme.test.ts
git commit -m "feat(branding): brand-theme preset table + apply/persist"
```

---

## Task 7: globals.css 主题预设块

**Files:**
- Modify: `packages/ui/src/styles/globals.css`

- [ ] **Step 1: 在 `.dark {…}` 块之后插入预设覆盖**

```css
/* ─── 品牌主题色预设（data-brand-theme 切换；明/暗各一套） ─── */
:root[data-brand-theme="green"] {
  --primary: oklch(0.55 0.13 155);
  --primary-foreground: oklch(0.98 0.02 155);
  --sidebar-primary: oklch(0.55 0.13 155);
  --sidebar-primary-foreground: oklch(0.98 0.02 155);
  --ring: oklch(0.55 0.13 155);
}
:root[data-brand-theme="green"].dark {
  --primary: oklch(0.62 0.12 155);
  --primary-foreground: oklch(0.98 0.02 155);
  --sidebar-primary: oklch(0.66 0.13 155);
}
:root[data-brand-theme="teal"] {
  --primary: oklch(0.6 0.12 200);
  --primary-foreground: oklch(0.98 0.02 200);
  --sidebar-primary: oklch(0.6 0.12 200);
  --ring: oklch(0.6 0.12 200);
}
:root[data-brand-theme="teal"].dark {
  --primary: oklch(0.68 0.11 200);
  --sidebar-primary: oklch(0.7 0.12 200);
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/ui/src/styles/globals.css
git commit -m "feat(branding): add brand-theme color presets to globals.css"
```

---

## Task 8: 启动时套用主题 + 设置页选择 UI

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/components/settings/general-settings.tsx`

- [ ] **Step 1: main.tsx 渲染前套用已存主题**

在 `apps/web/src/main.tsx` 的 `import "@workspace/ui/globals.css"` 之后、`createRoot` 之前加：

```typescript
import { applyBrandTheme, getStoredBrandTheme } from "@/lib/brand/brand-theme"
applyBrandTheme(getStoredBrandTheme())
```

- [ ] **Step 2: 设置页加「主题色」卡片**

在 `general-settings.tsx` 「外观设置」Card 内、深浅色 grid 之后追加一段（复用 `ThemeCard` 的视觉，但用色块）。先在文件顶部加：

```typescript
import { applyBrandTheme, getStoredBrandTheme, BRAND_THEMES } from "@/lib/brand/brand-theme"
```

组件内加 state：

```typescript
const [brandTheme, setBrandTheme] = React.useState(getStoredBrandTheme)
const handleBrandTheme = (id: string) => { applyBrandTheme(id); setBrandTheme(id) }
```

在「外观设置」CardContent 的深浅 grid 之后插入：

```tsx
<div className="mt-4 border-t pt-4">
  <p className="mb-3 text-sm font-medium">主题色</p>
  <div className="grid grid-cols-3 gap-3">
    {BRAND_THEMES.map((t) => (
      <button
        key={t.id}
        type="button"
        onClick={() => handleBrandTheme(t.id)}
        className={
          "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors hover:bg-accent/50 " +
          (brandTheme === t.id ? "border-primary bg-primary/5" : "border-transparent")
        }
      >
        <span className="size-8 rounded-full" style={{ background: t.swatch }} />
        <span className="text-sm font-medium">{t.label}</span>
        <span className="text-xs text-muted-foreground">{t.description}</span>
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 3: typecheck + 跑相关测试**

Run: `pnpm --filter web typecheck`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/main.tsx apps/web/src/components/settings/general-settings.tsx
git commit -m "feat(branding): apply brand-theme on boot + settings picker"
```

---

## Task 9: renderer 品牌字样去硬编码

**Files:**
- Modify: `apps/web/src/components/settings/about-settings.tsx`
- Modify: `apps/web/src/routes/login.tsx`
- Modify: `apps/web/src/routes/register.tsx`
- Modify: `apps/web/src/components/employee/recruitment-page.tsx`
- Modify: `apps/web/src/components/chat/shell/app-titlebar.tsx`
- Modify: `apps/web/src/components/chat/curator/curator-empty-welcome.tsx`

- [ ] **Step 1: about-settings 用 brand**

`about-settings.tsx`：顶部加 `import { useBrand, withYear } from "@/lib/brand/brand"`；组件内 `const brand = useBrand()`；
- logo `<img src={logoSvg} …>` → `src={brand.logos.app}`（删除 `import logoSvg`）。
- `<span …>BobanStaff</span>` → `{brand.productName}`。
- 副标题 `数字员工智能助手` → `{brand.subtitle}`。
- `© {new Date().getFullYear()} Bobandata. All rights reserved.` → `{withYear(brand.copyright)}`。

- [ ] **Step 2: 其余文件逐一替换品牌字样**

逐文件把硬编码 `BobanStaff`/`数字员工`(产品名语义处)/`Bobandata`/logo import 改成 `useBrand()` 对应字段。
对每个文件：加 `import { useBrand } from "@/lib/brand/brand"`、`const brand = useBrand()`，替换字面量。
（功能性文案不动；仅替换品牌名/公司名/版权/产品 logo。）

- [ ] **Step 3: 搜残留**

Run: `pnpm --filter web exec grep -rn "BobanStaff\|Bobandata" src/ || true`（或用编辑器搜）
Expected: 仅剩注释/非展示用途；展示位均已改 brand。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter web typecheck`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add apps/web/src
git commit -m "refactor(branding): read brand identity from useBrand in UI"
```

---

## Task 10: 主进程窗口标题 / app 名 / splash 用 brand

**Files:**
- Modify: `apps/web/electron/main/app-product.ts`
- Modify: 主窗口创建处（`electron/core/services/window-manager.ts` 或 `features/auth/window-login.ts` 等设置 `title` 的地方）
- Modify: `electron/features/splash/window-splash.ts`

- [ ] **Step 1: app-product 从 brand 取**

```typescript
// apps/web/electron/main/app-product.ts
import { getResolvedBrand } from "../features/branding/brand-config"
/** 用户可见产品名 */
export const APP_DISPLAY_NAME = getResolvedBrand().productName
```

> 若存在「模块加载早于 app ready」导致 `process.resourcesPath` 未就绪的风险，将 `APP_DISPLAY_NAME` 改为 `getAppDisplayName()` 函数并在调用点取值。执行时按实际加载时序定。

- [ ] **Step 2: 窗口标题与 splash 用 brand**

在创建 `BrowserWindow` 设 `title` 处用 `getResolvedBrand().windowTitle`；splash 若显示 logo/名，用 `getResolvedBrand()`。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter web typecheck`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add apps/web/electron
git commit -m "feat(branding): main-process window title/app name/splash from brand"
```

---

## Task 11: branding 资源目录 + 打包 extraResources

**Files:**
- Create: `apps/web/branding/default/brand.json` + 拷 `logo.png`（来自 `apps/web/public/logo.png`）
- Create: `apps/web/branding/guowang/brand.json` + 占位图
- Create: `apps/web/branding/README.md`
- Modify: `apps/web/electron-builder.json5`、`apps/web/electron-builder.offline.json5`
- Modify: `apps/web/index.html`

- [ ] **Step 1: default 包**

`apps/web/branding/default/brand.json`：
```json
{
  "productName": "数字员工",
  "windowTitle": "BobanStaff",
  "subtitle": "数字员工智能助手",
  "companyName": "Bobandata",
  "copyright": "© {year} Bobandata. All rights reserved.",
  "logos": { "app": "logo.png", "login": "logo.png", "splash": "logo.png" }
}
```
拷图：`cp apps/web/public/logo.png apps/web/branding/default/logo.png`

- [ ] **Step 2: guowang 示例**

`apps/web/branding/guowang/brand.json`：
```json
{
  "productName": "国网数字员工",
  "windowTitle": "国网数字员工",
  "subtitle": "数字员工智能助手",
  "companyName": "国家电网",
  "copyright": "© {year} 国家电网. All rights reserved.",
  "logos": { "app": "logo.png", "login": "logo.png", "splash": "logo.png" },
  "defaultTheme": "green"
}
```
占位图：`cp apps/web/public/logo.png apps/web/branding/guowang/logo.png`（工程人员后续替换为国网 logo）

- [ ] **Step 3: extraResources 加 branding**

两个 electron-builder json5 的 `extraResources` 数组各加：
```json5
{ "from": "branding", "to": "branding" }
```

- [ ] **Step 4: index.html title 改通用占位**

`<title>BobanStaff</title>` → `<title>数字员工</title>`（renderer 启动后由 brand 覆盖 document.title；见 Task 12）。

- [ ] **Step 5: README**

`apps/web/branding/README.md` 写：目录结构、brand.json 字段含义、如何加新品牌（复制 guowang → 改 json + 换图）、deploy.sh 如何选用（见 Task 13）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/branding apps/web/electron-builder.json5 apps/web/electron-builder.offline.json5 apps/web/index.html
git commit -m "feat(branding): add branding asset dirs + bundle via extraResources"
```

---

## Task 12: renderer 启动设 document.title

**Files:**
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: 套用品牌窗口标题**

在 `applyBrandTheme(...)` 之后加：
```typescript
import { getBrand } from "@/lib/brand/brand"
document.title = getBrand().windowTitle
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/main.tsx
git commit -m "feat(branding): set document.title from brand on boot"
```

---

## Task 13: deploy.sh 品牌目录集成（补丁说明）

**Files:**
- Create: `scripts/activation/deploy.sh.branding.patch.md`

- [ ] **Step 1: 写补丁说明（与现有 patch.md 风格一致）**

内容要点：
- 安装目录新增 `resources/branding/active/`；deploy.sh 增加 `stage_branding()`：若部署包同级存在 `branding/` 文件夹，则 `rsync -a --delete branding/ <install>/resources/branding/active/`。
- 无 `branding/` 文件夹时跳过（用打包内 default）。
- 工程人员做国网版：把国网 `brand.json` + logo 放进部署目录的 `branding/`，重跑 `deploy.sh` 即可，无需重打包。
- 给出 `record branding OK/…` 风格的总结接入示例。

- [ ] **Step 2: 提交**

```bash
git add scripts/activation/deploy.sh.branding.patch.md
git commit -m "docs(branding): deploy.sh branding-dir staging patch notes"
```

---

## Task 14: 全量校验

- [ ] **Step 1: 类型 + lint + 全测**

Run:
```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/lib/brand electron/features/branding
pnpm lint --filter=web
```
Expected: 全绿。

- [ ] **Step 2: 跑起来人工确认（按 /run 或 dev:app）**

Electron 下 about/登录/标题栏显示默认品牌、设置里切主题色即时生效；
设 `DE_BRANDING_DIR=apps/web/branding/guowang` 启动 → 显示「国网数字员工」+ 绿色默认主题，验证换包链路。

- [ ] **Step 3: 提交（如有收尾）**

```bash
git add -A && git commit -m "chore(branding): final verification fixes"
```

---

## Self-Review 摘要

- Spec A（品牌包）：Task 1–5、9–13 覆盖（类型/加载/IPC/renderer/重构/资源/打包/部署）。
- Spec B（主题色）：Task 6–8 覆盖（预设/css/启动+设置 UI）。
- deploy.sh 集成：Task 13。
- 非目标（打包期独立标识、任意取色器、远程下发、多语言）已排除。
- 类型一致：`ResolvedBrand`/`BrandManifest`/`getResolvedBrand`/`loadBrandFromDir`/`applyBrandTheme`/`getStoredBrandTheme`/`BRAND_THEMES`/`useBrand`/`getBrand`/`withYear` 全程一致。
- 已知执行期需现场判定点（已在对应 step 标注）：preload import 时序、`@/../electron` 别名是否可用、`APP_DISPLAY_NAME` 常量 vs 函数取值时序、bootstrap 注册位置。
