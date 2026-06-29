# 外观皮肤系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Tailwind v4 主题体系上新增一组"特殊风格"皮肤（含原创国网绿 + 移植 Proma 7 套），用 `data-theme` 整套换肤；删除旧 green/teal 主题色 accent 选择器。

**Architecture:** 每套皮肤是一个 `[data-theme="<id>"]` CSS 块，重定义全部颜色令牌。深色皮肤由 JS 同时打 `.dark` 使 `dark:` 工具类照常生效，皮肤令牌靠"在 .dark 之后定义、同特异性后写者赢"取胜。皮肤状态由 `lib/theme/skins.ts` 管理（localStorage + 跨窗口广播，复用现有 plumbing），与 ThemeProvider 的基础模式（浅/深/系统）二选一。

**Tech Stack:** React 19、Tailwind CSS v4（`@theme inline` + oklch 令牌）、Electron、Jotai 无关（用 React state + localStorage）、Vitest（happy-dom）。

**Spec:** `docs/superpowers/specs/2026-06-29-appearance-skins-design.md`

**关键约束（来自 spec 评审）：**
- 皮肤 CSS 块必须位于 `globals.css` 的 `.dark {}` 块**之后**；其后不得再写 `.dark` 颜色块。
- `SkinPreviewCard` 迷你 UI **只用语义令牌工具类**（`bg-background`/`bg-card`/`bg-primary`…），**禁止任何 `dark:` 变体**（亮皮肤卡在全局暗色下 `dark:` 会误触发）。
- 删 green/teal 时连同其 `.dark` 变体块（`:root[data-brand-theme="green"].dark` 等，特异性 (0,3,0)）**彻底删净**，否则反压新皮肤块。
- 皮肤激活时，ThemeProvider 的基础模式 class 写入（含 system 监听）必须让位给皮肤基调。

**命令参考：**
- 单测：`pnpm --filter boban-staff test:unit <文件>`（或 `cd apps/web && pnpm test:unit <文件>`；注意 `apps/web` 的包名是 `boban-staff`，`--filter web` 匹配不到）
- Lint：`pnpm --filter boban-staff lint`
- 类型：`npx tsc -b`（注意：`apps/web` 的 `pnpm typecheck` 实质空操作，且 `tsc -b` 有大量历史基线报错；只需确认**新增/改动文件不引入新错误**）

---

## File Structure

- **Create** `apps/web/src/lib/theme/skins.ts` — 皮肤清单 + 状态读写 + DOM 应用 + 旧值迁移。唯一的皮肤逻辑真相源。
- **Create** `apps/web/src/lib/theme/skins.test.ts` — skins.ts 单测。
- **Create** `apps/web/src/components/settings/skin-preview-card.tsx` — 皮肤预览卡（纯展示）。
- **Modify** `packages/ui/src/styles/globals.css` — 删 green/teal 块；加 8 个皮肤块。
- **Modify** `apps/web/src/main.tsx` — 首屏 applySkin。
- **Modify** `apps/web/src/components/theme-provider.tsx` — 皮肤感知（基础模式让位、跨窗口重应用皮肤）。
- **Modify** `apps/web/src/components/settings/general-settings.tsx` — 删 brand 色块；加特殊风格网格。
- **Delete** `apps/web/src/lib/brand/brand-theme.ts` + `brand-theme.test.ts`。
- **Modify** `apps/web/branding/guowang/brand.json` — `defaultTheme: "green"` → `"guowang-green"`。
- **Modify** `docs/field-deployment-manual.md`、`apps/web/branding/README.md` — `defaultTheme` 取值说明。
- **Audit/Modify** 12 个含硬编码背景的文件中的结构性表面。

---

## Task 1: 皮肤状态模块 `skins.ts`（TDD）

**Files:**
- Create: `apps/web/src/lib/theme/skins.ts`
- Test: `apps/web/src/lib/theme/skins.test.ts`

- [ ] **Step 1: 写失败测试** `apps/web/src/lib/theme/skins.test.ts`

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/theme/broadcast-appearance", () => ({
  broadcastAppearanceChanged: vi.fn(),
}))

import {
  SKINS,
  SKIN_STORAGE_KEY,
  getStoredSkin,
  applySkin,
  clearSkin,
  hasActiveSkin,
} from "./skins"

const root = () => document.documentElement

describe("skins", () => {
  beforeEach(() => {
    localStorage.clear()
    root().removeAttribute("data-theme")
    root().classList.remove("light", "dark")
  })

  it("含国网绿与 7 套移植皮肤", () => {
    const ids = SKINS.map((s) => s.id)
    expect(ids).toContain("guowang-green")
    expect(ids).toContain("ocean-dark")
    expect(SKINS).toHaveLength(8)
  })

  it("applySkin 写 data-theme + localStorage + 暗色基调", () => {
    applySkin("ocean-dark")
    expect(root().getAttribute("data-theme")).toBe("ocean-dark")
    expect(root().classList.contains("dark")).toBe(true)
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("ocean-dark")
  })

  it("亮色皮肤打 .light 不打 .dark", () => {
    root().classList.add("dark")
    applySkin("guowang-green")
    expect(root().classList.contains("dark")).toBe(false)
    expect(root().classList.contains("light")).toBe(true)
  })

  it("非法 id 清皮肤", () => {
    applySkin("ocean-dark")
    applySkin("nope")
    expect(root().getAttribute("data-theme")).toBe(null)
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("")
  })

  it("clearSkin 清 data-theme 与存储", () => {
    applySkin("ocean-dark")
    clearSkin()
    expect(root().getAttribute("data-theme")).toBe(null)
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("")
  })

  it("getStoredSkin 未存时用 fallback", () => {
    expect(getStoredSkin("guowang-green")).toBe("guowang-green")
  })

  it("getStoredSkin 迁移旧 brand-theme=green → guowang-green 并删旧键", () => {
    localStorage.setItem("brand-theme", "green")
    expect(getStoredSkin()).toBe("guowang-green")
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("guowang-green")
    expect(localStorage.getItem("brand-theme")).toBe(null)
  })

  it("getStoredSkin 迁移旧 teal/default → 无皮肤", () => {
    localStorage.setItem("brand-theme", "teal")
    expect(getStoredSkin()).toBe("")
  })

  it("hasActiveSkin 反映当前状态", () => {
    expect(hasActiveSkin()).toBe(false)
    applySkin("slate-dark")
    expect(hasActiveSkin()).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test:unit src/lib/theme/skins.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `apps/web/src/lib/theme/skins.ts`

```ts
import { broadcastAppearanceChanged } from "@/lib/theme/broadcast-appearance"

export type SkinBasis = "light" | "dark"

export interface SkinOption {
  id: string
  name: string
  basis: SkinBasis
}

/** localStorage 键：当前选中的特殊风格皮肤；空串表示无皮肤（走基础模式）。 */
export const SKIN_STORAGE_KEY = "appearance-skin"
/** 旧主题色键（已废弃），一次性迁移后删除。 */
const LEGACY_BRAND_KEY = "brand-theme"

/** 内置特殊风格皮肤。无皮肤时走 globals.css 的 :root / .dark 靛蓝默认。 */
export const SKINS: SkinOption[] = [
  { id: "guowang-green", name: "国网绿", basis: "light" },
  { id: "slate-light", name: "云朵舞者", basis: "light" },
  { id: "ocean-light", name: "晴空碧海", basis: "light" },
  { id: "forest-light", name: "森息晨光", basis: "light" },
  { id: "ocean-dark", name: "远山暮霭", basis: "dark" },
  { id: "forest-dark", name: "森息夜语", basis: "dark" },
  { id: "slate-dark", name: "莫兰迪夜", basis: "dark" },
  { id: "terminal-dark", name: "旧屏微光", basis: "dark" },
]

const BY_ID = new Map(SKINS.map((s) => [s.id, s]))

/** 旧主题色 id → 新皮肤 id 的一次性映射。teal/default → 无皮肤。 */
const LEGACY_MAP: Record<string, string> = {
  green: "guowang-green",
  teal: "",
  default: "",
}

/** 归一化为合法皮肤 id 或 ""（无皮肤）。 */
function normalize(id: string | null | undefined): string {
  if (!id) return ""
  if (BY_ID.has(id)) return id
  if (id in LEGACY_MAP) return LEGACY_MAP[id]
  return ""
}

/**
 * 读已存皮肤；用户没存过则回退 fallback（一般传品牌包 defaultTheme）。
 * 命中旧 brand-theme 残留时做一次性迁移：写入新键、删除旧键。
 */
export function getStoredSkin(fallback?: string): string {
  const stored = localStorage.getItem(SKIN_STORAGE_KEY)
  if (stored !== null) return normalize(stored)

  const legacy = localStorage.getItem(LEGACY_BRAND_KEY)
  if (legacy !== null) {
    const migrated = normalize(legacy)
    localStorage.setItem(SKIN_STORAGE_KEY, migrated)
    localStorage.removeItem(LEGACY_BRAND_KEY)
    return migrated
  }

  return normalize(fallback)
}

/** 应用皮肤的 DOM 副作用（属性 + 基调 class），不碰持久化。幂等。 */
export function applySkinToDOM(id: string): void {
  const root = document.documentElement
  const skin = BY_ID.get(id)
  if (!skin) {
    root.removeAttribute("data-theme")
    return
  }
  if (root.getAttribute("data-theme") !== id) {
    root.setAttribute("data-theme", id)
  }
  const wantDark = skin.basis === "dark"
  if (root.classList.contains("dark") !== wantDark) {
    root.classList.toggle("dark", wantDark)
  }
  if (root.classList.contains("light") !== !wantDark) {
    root.classList.toggle("light", !wantDark)
  }
}

/** 选皮肤：写 localStorage + apply DOM + 广播。id 空/非法时清皮肤回基础模式。 */
export function applySkin(id: string, options?: { broadcast?: boolean }): void {
  const next = normalize(id)
  localStorage.setItem(SKIN_STORAGE_KEY, next)
  applySkinToDOM(next)
  if (options?.broadcast !== false) {
    broadcastAppearanceChanged()
  }
}

/** 清皮肤：清 data-theme 与存储；基调 class 交回 ThemeProvider 重置。 */
export function clearSkin(options?: { broadcast?: boolean }): void {
  localStorage.setItem(SKIN_STORAGE_KEY, "")
  document.documentElement.removeAttribute("data-theme")
  if (options?.broadcast !== false) {
    broadcastAppearanceChanged()
  }
}

/** 当前是否激活了皮肤。 */
export function hasActiveSkin(): boolean {
  return normalize(localStorage.getItem(SKIN_STORAGE_KEY)) !== ""
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web test:unit src/lib/theme/skins.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/theme/skins.ts apps/web/src/lib/theme/skins.test.ts
git commit -m "feat(appearance): 皮肤状态模块 skins.ts（含旧 brand-theme 迁移）"
```

---

## Task 2: 皮肤令牌 CSS

**Files:**
- Modify: `packages/ui/src/styles/globals.css`（删 152–178 行 green/teal 块；在 `.dark {}` 块之后追加皮肤块）

- [ ] **Step 1: 删除旧 green/teal 块**

删除 `globals.css` 中以注释 `/* ─── 品牌主题色预设（data-brand-theme 切换…` 开头到 `:root[data-brand-theme="teal"].dark { … }` 结束的整段（约 152–178 行，含 4 个 `:root[data-brand-theme=…]` 块与注释）。确认删后文件里 `grep data-brand-theme` 无任何残留。

- [ ] **Step 2: 在 `.dark {}` 块之后插入皮肤块**

紧接 `.dark { … }` 闭合花括号之后插入（移植皮肤用 Proma 原 HSL 值保真，国网绿用 oklch 锚定品牌绿）：

```css
/* ─── 特殊风格皮肤（data-theme 切换；每套重定义全部颜色令牌）───────────────
   顺序约束：本段必须位于上面的 .dark 块之后。皮肤选择器 [data-theme="x"]
   特异性 (0,1,0) 与 .dark (0,1,0) 平手，靠"后写者赢"取胜——勿在本段之后再写 .dark 颜色块。
   深色皮肤由 JS（skins.ts）同时打 .dark，使组件 dark: 工具类照常生效；颜色由本段覆盖。
   移植自 Proma（HSL 原值免转换保真）；guowang-green 为本项目原创（oklch，锚定品牌绿）。 */

[data-theme="guowang-green"] {
  --background: oklch(0.99 0.005 155);
  --foreground: oklch(0.2 0.02 155);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.2 0.02 155);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.2 0.02 155);
  --primary: oklch(0.55 0.13 155);
  --primary-foreground: oklch(0.98 0.02 155);
  --secondary: oklch(0.96 0.01 155);
  --secondary-foreground: oklch(0.3 0.03 155);
  --muted: oklch(0.96 0.008 155);
  --muted-foreground: oklch(0.5 0.02 155);
  --accent: oklch(0.94 0.02 155);
  --accent-foreground: oklch(0.35 0.05 155);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.9 0.012 155);
  --input: oklch(0.9 0.012 155);
  --ring: oklch(0.55 0.13 155);
  --sidebar: oklch(0.97 0.012 155);
  --sidebar-foreground: oklch(0.2 0.02 155);
  --sidebar-primary: oklch(0.55 0.13 155);
  --sidebar-primary-foreground: oklch(0.98 0.02 155);
  --sidebar-accent: oklch(0.94 0.02 155);
  --sidebar-accent-foreground: oklch(0.35 0.05 155);
  --sidebar-border: oklch(0.9 0.012 155);
  --sidebar-ring: oklch(0.55 0.13 155);
}

[data-theme="slate-light"] {
  --background: hsl(40 6% 88%);
  --foreground: hsl(40 8% 18%);
  --card: hsl(40 8% 96%);
  --card-foreground: hsl(40 8% 18%);
  --popover: hsl(40 8% 96%);
  --popover-foreground: hsl(40 8% 18%);
  --primary: hsl(18 20% 67%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(40 6% 90%);
  --secondary-foreground: hsl(40 8% 22%);
  --muted: hsl(40 6% 85%);
  --muted-foreground: hsl(40 5% 45%);
  --accent: hsl(40 6% 86%);
  --accent-foreground: hsl(40 10% 30%);
  --destructive: hsl(0 65% 50%);
  --border: hsl(40 6% 80%);
  --input: hsl(40 6% 90%);
  --ring: hsl(18 20% 67%);
  --sidebar: hsl(40 6% 92%);
  --sidebar-foreground: hsl(40 8% 18%);
  --sidebar-primary: hsl(18 20% 67%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(40 6% 86%);
  --sidebar-accent-foreground: hsl(40 10% 30%);
  --sidebar-border: hsl(40 6% 80%);
  --sidebar-ring: hsl(18 20% 67%);
}

[data-theme="ocean-light"] {
  --background: hsl(205 35% 94%);
  --foreground: hsl(210 30% 15%);
  --card: hsl(205 30% 97%);
  --card-foreground: hsl(210 30% 15%);
  --popover: hsl(205 30% 97%);
  --popover-foreground: hsl(210 30% 15%);
  --primary: hsl(205 50% 50%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(205 35% 91%);
  --secondary-foreground: hsl(210 30% 20%);
  --muted: hsl(205 35% 88%);
  --muted-foreground: hsl(210 15% 40%);
  --accent: hsl(205 35% 82%);
  --accent-foreground: hsl(205 50% 30%);
  --destructive: hsl(0 84.2% 60.2%);
  --border: hsl(205 30% 82%);
  --input: hsl(205 35% 91%);
  --ring: hsl(205 50% 50%);
  --sidebar: hsl(205 35% 94%);
  --sidebar-foreground: hsl(210 30% 15%);
  --sidebar-primary: hsl(205 50% 50%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(205 35% 82%);
  --sidebar-accent-foreground: hsl(205 50% 30%);
  --sidebar-border: hsl(205 30% 82%);
  --sidebar-ring: hsl(205 50% 50%);
}

[data-theme="forest-light"] {
  --background: hsl(84 24% 92%);
  --foreground: hsl(132 16% 18%);
  --card: hsl(80 26% 96%);
  --card-foreground: hsl(132 16% 18%);
  --popover: hsl(80 26% 97%);
  --popover-foreground: hsl(132 16% 18%);
  --primary: hsl(134 24% 38%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(82 20% 90%);
  --secondary-foreground: hsl(132 16% 22%);
  --muted: hsl(82 18% 88%);
  --muted-foreground: hsl(96 8% 42%);
  --accent: hsl(76 20% 84%);
  --accent-foreground: hsl(132 24% 28%);
  --destructive: hsl(2 58% 48%);
  --border: hsl(84 14% 78%);
  --input: hsl(82 20% 90%);
  --ring: hsl(134 24% 42%);
  --sidebar: hsl(84 24% 92%);
  --sidebar-foreground: hsl(132 16% 18%);
  --sidebar-primary: hsl(134 24% 38%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(76 20% 84%);
  --sidebar-accent-foreground: hsl(132 24% 28%);
  --sidebar-border: hsl(84 14% 78%);
  --sidebar-ring: hsl(134 24% 42%);
}

[data-theme="ocean-dark"] {
  --background: hsl(210 12% 13%);
  --foreground: hsl(210 14% 92%);
  --card: hsl(210 8% 18%);
  --card-foreground: hsl(210 14% 92%);
  --popover: hsl(210 12% 18%);
  --popover-foreground: hsl(210 14% 92%);
  --primary: hsl(210 28% 48%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(210 12% 17%);
  --secondary-foreground: hsl(210 14% 92%);
  --muted: hsl(210 12% 17%);
  --muted-foreground: hsl(210 10% 60%);
  --accent: hsl(210 14% 22%);
  --accent-foreground: hsl(210 35% 70%);
  --destructive: hsl(0 55% 50%);
  --border: hsl(210 14% 24%);
  --input: hsl(210 12% 17%);
  --ring: hsl(210 35% 60%);
  --sidebar: hsl(210 12% 13%);
  --sidebar-foreground: hsl(210 14% 92%);
  --sidebar-primary: hsl(210 28% 48%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(210 14% 22%);
  --sidebar-accent-foreground: hsl(210 35% 70%);
  --sidebar-border: hsl(210 14% 24%);
  --sidebar-ring: hsl(210 35% 60%);
}

[data-theme="forest-dark"] {
  --background: hsl(150 8% 14%);
  --foreground: hsl(140 10% 92%);
  --card: hsl(150 10% 17%);
  --card-foreground: hsl(140 10% 92%);
  --popover: hsl(150 10% 19%);
  --popover-foreground: hsl(140 10% 92%);
  --primary: hsl(145 25% 42%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(150 10% 17%);
  --secondary-foreground: hsl(140 10% 92%);
  --muted: hsl(150 10% 17%);
  --muted-foreground: hsl(145 8% 60%);
  --accent: hsl(150 12% 22%);
  --accent-foreground: hsl(145 35% 65%);
  --destructive: hsl(0 55% 50%);
  --border: hsl(150 12% 25%);
  --input: hsl(150 10% 17%);
  --ring: hsl(145 35% 55%);
  --sidebar: hsl(150 8% 14%);
  --sidebar-foreground: hsl(140 10% 92%);
  --sidebar-primary: hsl(145 25% 42%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(150 12% 22%);
  --sidebar-accent-foreground: hsl(145 35% 65%);
  --sidebar-border: hsl(150 12% 25%);
  --sidebar-ring: hsl(145 35% 55%);
}

[data-theme="slate-dark"] {
  --background: hsl(260 6% 12%);
  --foreground: hsl(30 10% 90%);
  --card: hsl(260 6% 13%);
  --card-foreground: hsl(30 10% 90%);
  --popover: hsl(260 6% 15%);
  --popover-foreground: hsl(30 10% 90%);
  --primary: hsl(15 25% 68%);
  --primary-foreground: hsl(270 8% 9%);
  --secondary: hsl(260 5% 18%);
  --secondary-foreground: hsl(30 10% 88%);
  --muted: hsl(260 6% 16%);
  --muted-foreground: hsl(30 8% 60%);
  --accent: hsl(200 12% 22%);
  --accent-foreground: hsl(200 25% 75%);
  --destructive: hsl(0 45% 50%);
  --border: hsl(260 8% 26%);
  --input: hsl(260 6% 16%);
  --ring: hsl(15 45% 72%);
  --sidebar: hsl(260 6% 12%);
  --sidebar-foreground: hsl(30 10% 90%);
  --sidebar-primary: hsl(15 25% 68%);
  --sidebar-primary-foreground: hsl(270 8% 9%);
  --sidebar-accent: hsl(200 12% 22%);
  --sidebar-accent-foreground: hsl(200 25% 75%);
  --sidebar-border: hsl(260 8% 26%);
  --sidebar-ring: hsl(15 45% 72%);
}

[data-theme="terminal-dark"] {
  --background: hsl(100 6% 5%);
  --foreground: hsl(90 20% 65%);
  --card: hsl(100 6% 7%);
  --card-foreground: hsl(90 20% 65%);
  --popover: hsl(100 6% 8%);
  --popover-foreground: hsl(90 20% 65%);
  --primary: hsl(100 30% 48%);
  --primary-foreground: hsl(100 6% 5%);
  --secondary: hsl(100 5% 10%);
  --secondary-foreground: hsl(90 20% 65%);
  --muted: hsl(100 5% 10%);
  --muted-foreground: hsl(90 12% 38%);
  --accent: hsl(70 20% 18%);
  --accent-foreground: hsl(70 35% 58%);
  --destructive: hsl(10 35% 42%);
  --border: hsl(90 10% 18%);
  --input: hsl(100 5% 10%);
  --ring: hsl(100 35% 42%);
  --sidebar: hsl(100 6% 5%);
  --sidebar-foreground: hsl(90 20% 65%);
  --sidebar-primary: hsl(100 30% 48%);
  --sidebar-primary-foreground: hsl(100 6% 5%);
  --sidebar-accent: hsl(70 20% 18%);
  --sidebar-accent-foreground: hsl(70 35% 58%);
  --sidebar-border: hsl(90 10% 18%);
  --sidebar-ring: hsl(100 35% 42%);
}
```

- [ ] **Step 3: 校验 CSS 不破坏构建**

Run: `pnpm --filter web build` 的 CSS 处理可省略——改跑更快的 `pnpm --filter web dev` 起服务，浏览器手动在 devtools console 执行 `document.documentElement.setAttribute('data-theme','ocean-dark'); document.documentElement.classList.add('dark')`，确认页面整体换成深海蓝、侧栏/卡片/按钮协调；再 `removeAttribute('data-theme')` 回靛蓝。
Expected: 切换即时生效、无控制台报错。

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/styles/globals.css
git commit -m "feat(appearance): 8 套特殊风格皮肤令牌（删旧 green/teal accent）"
```

---

## Task 3: 首屏应用皮肤 `main.tsx`

**Files:**
- Modify: `apps/web/src/main.tsx:14,34-36`

- [ ] **Step 1: 替换 import 与首屏调用**

将第 14 行：
```ts
import { applyBrandTheme, getStoredBrandTheme } from "@/lib/brand/brand-theme"
```
改为：
```ts
import { applySkin, getStoredSkin } from "@/lib/theme/skins"
```

将第 34–36 行：
```ts
// 用户未选过主题色时，回退到品牌包指定的 defaultTheme。
const brand = getBrand()
applyBrandTheme(getStoredBrandTheme(brand.defaultTheme))
```
改为：
```ts
// 用户未选过特殊风格时，回退到品牌包指定的 defaultTheme（皮肤 id）。
const brand = getBrand()
applySkin(getStoredSkin(brand.defaultTheme), { broadcast: false })
```

> 注：首屏不广播（无其它窗口可同步，且避免无谓 IPC）。

- [ ] **Step 2: 校验**

Run: `pnpm --filter web lint`
Expected: 无新增 lint 错误（旧 import 已无引用）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/main.tsx
git commit -m "feat(appearance): 首屏 applySkin 替代 applyBrandTheme"
```

---

## Task 4: ThemeProvider 皮肤感知

**Files:**
- Modify: `apps/web/src/components/theme-provider.tsx`

- [ ] **Step 1: 替换 import**

第 3 行：
```ts
import { applyBrandTheme, getStoredBrandTheme } from "@/lib/brand/brand-theme"
```
改为：
```ts
import { applySkin, getStoredSkin, hasActiveSkin } from "@/lib/theme/skins"
```

- [ ] **Step 2: `applyTheme` 让位给皮肤**

在 `applyTheme` 回调体最前面加守卫（皮肤激活时基调 class 归皮肤管，基础模式不写）：
```ts
const applyTheme = React.useCallback(
  (nextTheme: Theme) => {
    if (hasActiveSkin()) {
      return
    }
    const root = document.documentElement
    // …原逻辑不变…
  },
  [disableTransitionOnChange]
)
```

> 这一条同时覆盖 system 监听：system 变化回调走 `applyTheme("system")`，皮肤激活时自动 no-op，不会踩掉皮肤基调。

- [ ] **Step 3: 跨窗口重应用改为皮肤优先**

`onThemeChanged` 的回调（约 188–198 行）：
```ts
api.onThemeChanged(() => {
  const storedTheme = localStorage.getItem(storageKey)
  if (isTheme(storedTheme)) {
    setThemeState(storedTheme)
  } else {
    setThemeState(defaultTheme)
  }
  const skin = getStoredSkin()
  if (skin) {
    applySkin(skin, { broadcast: false })
  } else {
    document.documentElement.removeAttribute("data-theme")
    applyTheme(isTheme(storedTheme) ? storedTheme : defaultTheme)
  }
})
```
> 注意：把 `applyTheme` 加入该 effect 依赖（与 `setThemeState` 一致）。

`storage` 事件回调（约 201–226 行）里两处 `applyBrandTheme(getStoredBrandTheme(), { broadcast: false })` 替换为相同的皮肤重应用逻辑。提取一个本地 helper 避免重复：
```ts
const reapplyAppearance = React.useCallback(
  (mode: Theme) => {
    const skin = getStoredSkin()
    if (skin) {
      applySkin(skin, { broadcast: false })
    } else {
      document.documentElement.removeAttribute("data-theme")
      applyTheme(mode)
    }
  },
  [applyTheme]
)
```
在 `onThemeChanged` 与 `storage` 两处 `setThemeState(...)` 后调用 `reapplyAppearance(...)`，删掉旧的 `applyBrandTheme(...)` 调用。两处传入的 mode 实参必须与该处 `setThemeState` 用的值一致——即 `isTheme(storedValue) ? storedValue : defaultTheme`（`onThemeChanged` 里 `storedValue` 是 `localStorage.getItem(storageKey)`，`storage` 里是 `event.newValue`）。

- [ ] **Step 4: `d` 快捷键在皮肤激活时不切换**

在 `handleKeyDown` 的 `if (event.key.toLowerCase() !== "d") return` 之后加：
```ts
if (hasActiveSkin()) {
  return
}
```
> 皮肤态下 `d` 键不动基础模式，避免"基础模式 stored 值与屏幕皮肤基调不一致"的困惑。要切回明/暗须走设置页选基础模式（会先 clearSkin）。

- [ ] **Step 5: 校验**

Run: `pnpm --filter web lint`
Expected: 无新增错误，无未用 import。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/theme-provider.tsx
git commit -m "feat(appearance): ThemeProvider 皮肤感知（基础模式让位 + 跨窗口重应用皮肤）"
```

---

## Task 5: 皮肤预览卡组件

**Files:**
- Create: `apps/web/src/components/settings/skin-preview-card.tsx`

- [ ] **Step 1: 实现组件**

```tsx
import { IconCheck } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { SkinOption } from "@/lib/theme/skins"

/**
 * 皮肤预览卡：局部 data-theme + 基调 class 作用域，渲染一段迷你 UI。
 * 约束：迷你 UI 只用语义令牌工具类，禁止任何 dark: 变体——
 * 否则亮皮肤卡在全局暗色下 dark: 会被祖先 .dark 误触发。
 */
export function SkinPreviewCard({
  skin,
  active,
  onSelect,
}: {
  skin: SkinOption
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col items-center gap-2 focus-visible:outline-none"
    >
      <div
        data-theme={skin.id}
        className={cn(
          skin.basis, // 局部 .light / .dark 基调
          "relative h-[120px] w-full overflow-hidden rounded-lg ring-1 transition-all",
          active
            ? "ring-2 ring-primary"
            : "ring-border/50 group-hover:ring-border"
        )}
      >
        <div className="flex h-full w-full bg-background">
          <div className="flex w-1/3 flex-col gap-1 bg-sidebar p-1.5">
            <div className="h-1.5 w-3/4 rounded-full bg-sidebar-primary" />
            <div className="h-1 w-full rounded-full bg-muted" />
            <div className="h-1 w-2/3 rounded-full bg-muted" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5 p-1.5">
            <div className="h-6 rounded-md bg-card" />
            <div className="h-1.5 w-1/2 rounded-full bg-primary" />
            <div className="h-1 w-full rounded-full bg-muted" />
            <div className="h-1 w-4/5 rounded-full bg-muted" />
          </div>
        </div>
        {active && (
          <div className="absolute right-1 top-1 z-10 flex size-4 items-center justify-center rounded-full bg-primary">
            <IconCheck className="size-2.5 text-primary-foreground" />
          </div>
        )}
      </div>
      <span
        className={cn(
          "text-xs font-medium transition-colors",
          active
            ? "text-foreground"
            : "text-muted-foreground group-hover:text-foreground"
        )}
      >
        {skin.name}
      </span>
    </button>
  )
}
```

> 注意：卡片**外层** label 文字吃全局 `text-foreground`（跟随 app）；**预览框内**所有色块吃局部 data-theme 作用域的令牌。卡内绝不能出现 `dark:xxx`。

- [ ] **Step 2: 校验**

Run: `pnpm --filter web lint`
Expected: 无错误（`IconCheck` 在 @tabler/icons-react 中存在）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/settings/skin-preview-card.tsx
git commit -m "feat(appearance): 皮肤预览卡组件（语义令牌迷你 UI，禁 dark:）"
```

---

## Task 6: 设置页接线

**Files:**
- Modify: `apps/web/src/components/settings/general-settings.tsx`

- [ ] **Step 1: 替换 import 与状态**

删除：
```ts
import {
  applyBrandTheme,
  getStoredBrandTheme,
  BRAND_THEMES,
} from "@/lib/brand/brand-theme"
```
新增：
```ts
import { applySkin, clearSkin, getStoredSkin, SKINS } from "@/lib/theme/skins"
import { SkinPreviewCard } from "./skin-preview-card"
```

把 `brandTheme` 相关 state/handler（约 63–75 行）替换为：
```ts
const [skin, setSkinState] = React.useState(getStoredSkin)

const handleSkin = (id: string) => {
  applySkin(id)
  setSkinState(id)
}

const handleBaseMode = (mode: "light" | "dark" | "system") => {
  clearSkin()
  setSkinState("")
  setTheme(mode)
}

React.useEffect(() => {
  return subscribeElectron((api) =>
    api.onThemeChanged(() => {
      setSkinState(getStoredSkin())
    })
  )
}, [])
```

- [ ] **Step 2: 改外观卡 JSX**

把"外观设置"Card 的 `CardContent`（约 347–399 行）整体替换为：
```tsx
<CardContent>
  <div className="grid grid-cols-3 gap-3">
    <ThemeCard
      label="浅色"
      icon={IconSun}
      description="明亮的浅色背景"
      active={!skin && theme === "light"}
      onClick={() => handleBaseMode("light")}
    />
    <ThemeCard
      label="深色"
      icon={IconMoon}
      description="暗色调护眼模式"
      active={!skin && theme === "dark"}
      onClick={() => handleBaseMode("dark")}
    />
    <ThemeCard
      label="跟随系统"
      icon={IconDeviceDesktop}
      description="自动适配系统主题"
      active={!skin && theme === "system"}
      onClick={() => handleBaseMode("system")}
    />
  </div>

  <div className="mt-4 border-t pt-4">
    <p className="mb-3 text-sm font-medium">特殊风格</p>
    <div className="grid grid-cols-4 gap-3">
      {SKINS.map((s) => (
        <SkinPreviewCard
          key={s.id}
          skin={s}
          active={skin === s.id}
          onSelect={() => handleSkin(s.id)}
        />
      ))}
    </div>
  </div>
</CardContent>
```

> `useTheme()` 的 `theme/setTheme` 仍从原 hook 取（已存在，约 62 行 `const { theme, setTheme } = useTheme()`）。

- [ ] **Step 3: 手测**

Run: `pnpm --filter web dev`，打开设置→通用设置→外观。
Expected：
- 三个模式卡 + 8 个皮肤预览卡（4 列 2 行），每卡迷你 UI 用各自配色。
- 点皮肤：全 app 换肤、模式卡取消高亮、卡上打勾。
- 点模式：清皮肤回靛蓝、对应模式卡高亮。
- **亮皮肤卡在深色模式下、暗皮肤卡在浅色模式下**预览框配色都正确（验证 dark: 陷阱已规避）。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/settings/general-settings.tsx
git commit -m "feat(appearance): 设置页特殊风格网格替代旧主题色色块"
```

---

## Task 7: 删除 brand-theme 模块

**Files:**
- Delete: `apps/web/src/lib/brand/brand-theme.ts`、`apps/web/src/lib/brand/brand-theme.test.ts`

- [ ] **Step 1: 确认无残留引用**

Run: `git grep -n "brand-theme\|applyBrandTheme\|getStoredBrandTheme\|BRAND_THEMES\|BRAND_THEME_STORAGE_KEY" -- apps/web/src`
Expected: 无输出（Task 3/4/6 已迁移所有引用）。若有，先改完。

- [ ] **Step 2: 删除文件**

```bash
git rm apps/web/src/lib/brand/brand-theme.ts apps/web/src/lib/brand/brand-theme.test.ts
```

- [ ] **Step 3: 跑全量单测**

Run: `pnpm --filter web test:unit`
Expected: 全绿（skins.test.ts 在内，brand-theme.test.ts 已删）。

- [ ] **Step 4: 提交**

```bash
git commit -m "refactor(appearance): 删除已被 skins.ts 取代的 brand-theme 模块"
```

---

## Task 8: 白标默认皮肤 + 文档

**Files:**
- Modify: `apps/web/branding/guowang/brand.json`
- Modify: `docs/field-deployment-manual.md:207-210`、`apps/web/branding/README.md:35`

- [ ] **Step 1: 国网包默认皮肤**

`apps/web/branding/guowang/brand.json` 的 `"defaultTheme": "green"` 改为 `"defaultTheme": "guowang-green"`。

- [ ] **Step 2: 更新文档取值说明**

`docs/field-deployment-manual.md` 第 207、210 行与 `apps/web/branding/README.md` 第 35 行：把 `defaultTheme` 的可选值说明从"`default` 靛蓝 / `green` 国网绿 / `teal` 青蓝"改为：

> `defaultTheme` 可选：首次启动的默认特殊风格皮肤 id。可选值见 `apps/web/src/lib/theme/skins.ts` 的 `SKINS`（如 `guowang-green` 国网绿、`ocean-dark` 远山暮霭…）。留空则用靛蓝默认（浅/深/跟随系统）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/branding/guowang/brand.json docs/field-deployment-manual.md apps/web/branding/README.md
git commit -m "feat(appearance): 国网白标默认 guowang-green 皮肤 + 文档更新"
```

---

## Task 9: 硬编码背景审计

**Files（12 个，逐一判断）：**
`employee/candidate-card.tsx`、`employee/employee-detail-dialog.tsx`、`artifact/artifact-content/html-artifact-renderer.tsx`、`workbench/workbench-html-panel.tsx`、`workbench/task-status-badge.tsx`、`chat/panel/tasks-panel.tsx`、`settings/account-settings.tsx`、`chat/message-blocks/execution-report-card.tsx`、`schedule-monitor/sections/execution-detail.tsx`、`chat/contacts/contact-detail-panel.tsx`、`chat/contacts/contacts-panel.tsx`、`chat/contacts/contact-avatars.tsx`

- [ ] **Step 1: 逐处归类**

Run: `git grep -n "bg-\(white\|black\|zinc-\|gray-\|neutral-\|slate-\|stone-\)[0-9]*\|bg-\[#" -- apps/web/src`
对每处判断：
- **结构性表面**（面板/容器/卡片底，本应随皮肤变）→ 换语义令牌：`bg-white`→`bg-background` 或 `bg-card`；`bg-zinc-900/950`→`bg-card`/`bg-background`；`bg-zinc-100/muted`→`bg-muted`。
- **语义固定色**（状态徽章、头像底、HTML 产物渲染容器 `html-artifact-renderer`/`workbench-html-panel`——这些渲染用户产物，必须固定白底）→ **不动**。
- 明确跳过：`task-status-badge.tsx`（状态色）、`contact-avatars.tsx`（头像底色）、两个 html 产物渲染器。

- [ ] **Step 2: 仅改结构性表面**

逐文件改判定为结构性的那几处。每处改完在 dev 里目视该组件在某深色皮肤（如 ocean-dark）下不再突兀露白/露黑。

- [ ] **Step 3: 校验 + 提交**

Run: `pnpm --filter web lint`
```bash
git add -A apps/web/src
git commit -m "fix(appearance): 结构性表面改语义令牌以跟随皮肤换肤"
```

---

## Task 10: 最终验证

- [ ] **Step 1: 单测 + lint**

Run: `pnpm --filter web test:unit` → 全绿
Run: `pnpm --filter web lint` → 无新增错误

- [ ] **Step 2: 类型（仅看新增/改动文件无新错）**

Run: `npx tsc -b`（基线有历史报错，重点确认本次改动文件 skins.ts / theme-provider.tsx / skin-preview-card.tsx / general-settings.tsx / main.tsx 不引入新错误）

- [ ] **Step 3: 手测矩阵（重启 dev / 桌面端）**

逐项确认：
1. 8 套皮肤逐一切换：侧栏 / 内容区 / 卡片 / 主色按钮 / 输入框 / 弹窗（设置 Dialog）/ Markdown 代码块 均协调换肤。
2. 深色皮肤（ocean/forest/slate/terminal-dark）下，含 `dark:` 工具类的页面正常显示（验证 .dark 与皮肤令牌共存）。
3. 切回 浅色/深色/系统：回靛蓝默认，皮肤打勾消失，模式卡高亮正确。
4. 预览卡：亮皮肤卡 @ 全局深色、暗皮肤卡 @ 全局浅色，预览框配色均正确。
5. 多窗口同步：主窗与设置窗（若独立窗口）切皮肤时另一窗实时跟随。
6. 国网白标包：清空 localStorage 后首屏直接进 `guowang-green`（`brand.defaultTheme`）。
7. 旧值迁移：手动 `localStorage.setItem('brand-theme','green')` 后清 `appearance-skin` 重载，确认迁移到 guowang-green 且旧键被删。

- [ ] **Step 4: finishing**

进入 superpowers:finishing-a-development-branch 决定合并/PR/清理。

---

## YAGNI 边界（不做）

- 经典/现代界面风格、界面缩放、Markdown 字号、应用图标选择器。
- Proma 额外令牌词汇（content-area / tabbar-surface / code-bg / dialog / dashed-border / shadow-* 等）。
- terminal 皮肤的扫描线/辉光/闪烁动画——只取配色。
- 皮肤的明/暗双变体；国网绿暂只 light。
- 复用 Proma webp 预览插画。
- `--chart-*` / `--wb-*` 数据色板的逐皮肤覆盖（沿用基调亮/暗值）。

## 对 spec 的一处实现细化（已在本计划落地）

spec 第 2 节写"HSL → oklch"。实现改为：**移植皮肤保留 Proma 原 HSL 值并用 `hsl()` 包裹**（v4 下 `@theme inline` 对颜色空间无感，`hsl()`/`oklch()` 消费方式一致），换取**零转换、保真 Proma 手调观感**；仅国网绿用 oklch（锚定现有品牌绿）。同一代码库混用两种颜色记法对构建与透明度修饰（v4 用 `color-mix()`）均安全。
