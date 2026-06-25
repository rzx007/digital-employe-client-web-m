# 视觉语言层升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `design/数字员工 工作台.dc.html` 的视觉语言整体移植到现有应用（双字体 + 设计令牌 + 深色 rail + 核心母题 + 5 套主题方向切换器），只换皮不换骨。

**Architecture:** 令牌采用「var 间接别名」分层——每套方向只定义**设计语义令牌**（`--bg/--surface/--rail/--ink/--brand/--highlight/--pos/...`，从设计稿近乎逐字复制，仅 2 处改名避冲突），再用**一个全局别名块**把 shadcn 变量（`--background/--card/--foreground/--primary/...`）指向设计令牌（`var(...)`）。方向用 `<html data-dir>` 属性叠加，与现有 `.dark` class 正交。母题做成 `packages/ui` 共享件，测试放 `apps/web` 的 vitest。外壳三处（titlebar/rail/statusbar）仅 restyle 不改结构。

**Tech Stack:** React 19、Tailwind CSS v4（`@theme inline`）、shadcn、`@fontsource`、TanStack Router、vitest + happy-dom + @testing-library/react、pnpm workspace（Turbo）。

**参照 spec：** `docs/superpowers/specs/2026-06-25-visual-language-upgrade-design.md`

---

## 命名映射总表（实现期反复参照）

设计稿令牌 → 本仓库落地名（仅这 2 族在转写时改名，其余保持设计名）：

| 设计稿名 | 落地名 | 原因 |
|---|---|---|
| `--accent` | `--highlight` | 避开 shadcn 中性 hover 的 `--accent` |
| `--accent-ink` | `--highlight-ink` | 同上 |
| `--accent-soft` | `--highlight-soft` | 同上 |
| `--muted`（设计=中灰文字） | `--text-muted` | 避开 shadcn 背景色 `--muted` |
| 其余全部 | 同名保留 | `--bg/--surface/--surface-2/--surface-3/--rail/--rail-2/--rail-text/--ink/--ink-2/--faint/--line/--line-2/--brand/--brand-ink/--brand-soft/--pos/--pos-soft/--neg/--neg-soft/--shadow/--shadow-lg` |

shadcn 变量 → 指向的设计令牌（全局别名块，写一次，靠 `var()` 间接随方向变化）：

| shadcn 变量 | = | 设计令牌 |
|---|---|---|
| `--background` | | `var(--bg)` |
| `--card` / `--popover` | | `var(--surface)` |
| `--card-foreground` / `--popover-foreground` | | `var(--ink)` |
| `--foreground` | | `var(--ink)` |
| `--muted`（bg） | | `var(--surface-2)` |
| `--muted-foreground` | | `var(--text-muted)` |
| `--secondary` | | `var(--surface-3)` |
| `--secondary-foreground` | | `var(--ink-2)` |
| `--border` | | `var(--line)` |
| `--input` | | `var(--line-2)` |
| `--ring` | | `var(--brand)` |
| `--primary` | | `var(--brand)` |
| `--destructive` | | `var(--neg)` |

**保持不动**（无设计对应、限定 scope）：`--accent`、`--accent-foreground`（中性 hover）、`--primary-foreground`、`--sidebar*`、`--chart-*`、`--wb-*`。这些仍由现有 `:root` / `.dark` 的明暗两套值提供。

> klein/graphite/warm/blue 四个方向块**不定义** `--pos/--pos-soft/--neg/--neg-soft/--shadow/--shadow-lg`——它们从基线 petrol 继承（设计稿即如此）。

---

## Task 1: 字体依赖 + Tailwind 主题暴露

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/styles/globals.css`（顶部 `@import` 区 + `@theme inline` 块 + base layer keyframes）

- [ ] **Step 1: 安装字体包**

Run:
```bash
pnpm --filter @workspace/ui add @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono
```
Expected: 两包写入 `packages/ui/package.json` dependencies，pnpm 安装成功。

- [ ] **Step 2: 在 globals.css 顶部追加字体 @import**

在 `packages/ui/src/styles/globals.css` 现有 `@import "@fontsource-variable/lora";`（第 4 行）**下方**插入（lora 保留不动）：
```css
@import "@fontsource/ibm-plex-sans/400.css";
@import "@fontsource/ibm-plex-sans/500.css";
@import "@fontsource/ibm-plex-sans/600.css";
@import "@fontsource/ibm-plex-mono/400.css";
@import "@fontsource/ibm-plex-mono/500.css";
@import "@fontsource/ibm-plex-mono/600.css";
```

- [ ] **Step 3: 改写 @theme inline 的字体并新增 mono / 新令牌色 / 阴影 / 动画**

在 `@theme inline { ... }` 块内：把 `--font-sans: 'Raleway Variable', sans-serif;` 改为：
```css
  --font-sans: 'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace;
```
并在该块内（紧接现有 `--color-*` 列表之后、`--radius-*` 之前）追加：
```css
  /* 设计语言令牌 → Tailwind 颜色 */
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-rail: var(--rail);
  --color-rail-2: var(--rail-2);
  --color-rail-text: var(--rail-text);
  --color-ink-2: var(--ink-2);
  --color-faint: var(--faint);
  --color-line-2: var(--line-2);
  --color-brand: var(--brand);
  --color-brand-ink: var(--brand-ink);
  --color-brand-soft: var(--brand-soft);
  --color-highlight: var(--highlight);
  --color-highlight-ink: var(--highlight-ink);
  --color-highlight-soft: var(--highlight-soft);
  --color-pos: var(--pos);
  --color-pos-soft: var(--pos-soft);
  --color-neg: var(--neg);
  --color-neg-soft: var(--neg-soft);
  /* 阴影工具类 shadow-card / shadow-float */
  --shadow-card: var(--shadow);
  --shadow-float: var(--shadow-lg);
  /* 脉冲动画 animate-pulse-dot */
  --animate-pulse-dot: pulse-dot 2s ease-in-out infinite;
```

- [ ] **Step 4: 在 base layer 增加脉冲 keyframes**

在 `@layer base { ... }` 内（任意位置，建议 body 规则之后）追加：
```css
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
```

- [ ] **Step 5: 构建验证（此时令牌尚未定义，仅验证字体与 @theme 不报错）**

Run:
```bash
pnpm --filter web build
```
Expected: 构建成功，无 CSS 解析错误。（`var(--surface-2)` 等此刻解析为空但合法，下一任务补值。）

- [ ] **Step 6: Commit**

```bash
git add packages/ui/package.json packages/ui/src/styles/globals.css pnpm-lock.yaml
git commit -m "feat(ui): 引入 IBM Plex 双字体 + 暴露设计令牌色/阴影/脉冲动画"
```

---

## Task 2: 基线令牌（petrol/沉稳）+ shadcn 别名映射

把设计稿基线 `[data-theme=light/dark]`（即 petrol）写进 `:root` / `.dark`，并加一次性别名块。

**Files:**
- Modify: `packages/ui/src/styles/globals.css`（`:root` 与 `.dark` 块）

> ⚠️ **级联关键**：`.dark` 里对 `--background/--primary/...` 的字面值**特异性高于** `:root` 的别名，会在暗色模式遮蔽别名。因此本任务必须**从 `:root` 和 `.dark` 两处删除这 15 个将被别名接管的字面量**，让它们统一由 `:root` 的别名 `var(--bg)` 等解析（在 `.dark` 下解析到 `.dark` 的设计令牌）。
>
> 需删除的 15 个字面量（两块都删）：`--background`、`--foreground`、`--card`、`--card-foreground`、`--popover`、`--popover-foreground`、`--primary`、`--secondary`、`--secondary-foreground`、`--muted`、`--muted-foreground`、`--destructive`、`--border`、`--input`、`--ring`。
>
> **保留不动**（无设计对应）：`--primary-foreground`、`--accent`、`--accent-foreground`、`--sidebar*`、`--chart-*`、`--wb-*`、`--radius`。

- [ ] **Step 1: 在 `:root` 块内删除冲突字面量并追加 petrol(light) 设计令牌 + 别名块**

在现有 `:root { ... }` 内：先**删除**上述 15 个字面量行；**保留** `--primary-foreground/--accent/--accent-foreground/--sidebar*/--chart-*/--wb-*/--radius`；再追加以下设计令牌（值取自设计稿第 17–41 行，已应用改名表）：
```css
  /* ── 设计语言令牌：petrol/沉稳 light（基线） ── */
  --bg: oklch(0.98 0.0035 248);
  --surface: oklch(1 0 0);
  --surface-2: oklch(0.985 0.004 248);
  --surface-3: oklch(0.963 0.006 248);
  --rail: oklch(0.255 0.042 252);
  --rail-2: oklch(0.215 0.042 252);
  --rail-text: oklch(0.73 0.025 252);
  --ink: oklch(0.255 0.02 256);
  --ink-2: oklch(0.4 0.018 256);
  --text-muted: oklch(0.535 0.015 256);
  --faint: oklch(0.665 0.012 256);
  --line: oklch(0.935 0.004 250);
  --line-2: oklch(0.895 0.005 250);
  --brand: oklch(0.505 0.12 244);
  --brand-ink: oklch(0.435 0.125 246);
  --brand-soft: oklch(0.962 0.03 246);
  --pos: oklch(0.58 0.12 160);
  --pos-soft: oklch(0.955 0.045 160);
  --neg: oklch(0.57 0.16 26);
  --neg-soft: oklch(0.96 0.03 26);
  --highlight: oklch(0.74 0.13 74);
  --highlight-ink: oklch(0.56 0.13 66);
  --highlight-soft: oklch(0.93 0.06 80);
  --shadow: 0 1px 1px rgba(18,28,54,.04), 0 4px 12px -2px rgba(18,28,54,.06);
  --shadow-lg: 0 30px 80px -12px rgba(18,28,54,.22);
  /* ── shadcn 变量 → 设计令牌（别名，写一次随方向变化） ── */
  --background: var(--bg);
  --foreground: var(--ink);
  --card: var(--surface);
  --card-foreground: var(--ink);
  --popover: var(--surface);
  --popover-foreground: var(--ink);
  --muted: var(--surface-2);
  --muted-foreground: var(--text-muted);
  --secondary: var(--surface-3);
  --secondary-foreground: var(--ink-2);
  --border: var(--line);
  --input: var(--line-2);
  --ring: var(--brand);
  --primary: var(--brand);
  --destructive: var(--neg);
```

> 注：因 Step 1 已删除 `:root` 里的 15 个旧字面量，别名块成为这些变量在 `:root` 的唯一定义，`var(--bg)` 等正常生效。

- [ ] **Step 2: 在 `.dark` 块内删除冲突字面量并仅追加 petrol(dark) 设计令牌**

在现有 `.dark { ... }` 内：先**删除**上述同样的 15 个字面量行（`--background/--foreground/--card/--card-foreground/--popover/--popover-foreground/--primary/--secondary/--secondary-foreground/--muted/--muted-foreground/--destructive/--border/--input/--ring`）；**保留** `--primary-foreground/--accent/--accent-foreground/--sidebar*/--chart-*/--wb-*`；再追加以下设计令牌（值取自设计稿第 42–66 行）。`.dark` **不写别名块**——别名在 `:root`，此处只覆盖被 `var()` 引用的设计令牌即可级联生效：
```css
  /* ── 设计语言令牌：petrol/沉稳 dark（基线） ── */
  --bg: oklch(0.168 0.012 248);
  --surface: oklch(0.214 0.013 248);
  --surface-2: oklch(0.244 0.013 248);
  --surface-3: oklch(0.27 0.013 248);
  --rail: oklch(0.152 0.014 248);
  --rail-2: oklch(0.13 0.014 248);
  --rail-text: oklch(0.7 0.018 248);
  --ink: oklch(0.95 0.005 248);
  --ink-2: oklch(0.8 0.01 248);
  --text-muted: oklch(0.66 0.012 248);
  --faint: oklch(0.55 0.012 248);
  --line: oklch(0.305 0.012 248);
  --line-2: oklch(0.37 0.012 248);
  --brand: oklch(0.68 0.1 242);
  --brand-ink: oklch(0.74 0.1 242);
  --brand-soft: oklch(0.3 0.045 242);
  --pos: oklch(0.72 0.13 158);
  --pos-soft: oklch(0.32 0.05 158);
  --neg: oklch(0.7 0.16 28);
  --neg-soft: oklch(0.33 0.05 28);
  --highlight: oklch(0.8 0.13 78);
  --highlight-ink: oklch(0.82 0.12 78);
  --highlight-soft: oklch(0.34 0.06 70);
  --shadow: 0 1px 2px rgba(0,0,0,.35);
  --shadow-lg: 0 28px 80px rgba(0,0,0,.6);
```
> `.dark` **无需重复别名块**——`--background: var(--bg)` 等在 `:root` 已定义，`.dark` 只覆盖被 `var()` 引用的设计令牌即可级联生效。

- [ ] **Step 3: 构建验证**

Run:
```bash
pnpm --filter web build
```
Expected: 构建成功。

- [ ] **Step 4: 人工冒烟（dev）— 重点验暗色级联**

Run:
```bash
pnpm --filter web dev
```
打开应用，目视：整体底色/卡片/文字呈 petrol 沉稳青蓝调；**切到暗色（按 `d` 键或设置页）后底色/卡片/主色仍为 petrol 暗色调（非旧灰阶/旧蓝）——这是验证 Step 1/2 删除冲突字面量是否到位的关键**；无大面积错色。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/styles/globals.css
git commit -m "feat(ui): petrol 基线设计令牌 + shadcn 变量别名映射"
```

---

## Task 3: 其余 4 套主题方向令牌（klein/graphite/warm/blue）

每方向两块：light = `[data-dir="x"]`，dark = `.dark[data-dir="x"]`。值取自设计稿对应行（已应用改名表：`accent→highlight`、`muted→text-muted`）。这些块**只定义被覆盖的设计令牌**，不写别名（别名已在 `:root`）。

**Files:**
- Modify: `packages/ui/src/styles/globals.css`（在 `.dark` 块之后新增方向块）

- [ ] **Step 1: 追加 klein/精致靛蓝（设计稿 68/69 行）**

```css
/* ===== 精致靛蓝 / klein ===== */
[data-dir="klein"] {
  --bg: oklch(0.985 0.005 285); --surface: oklch(1 0 0); --surface-2: oklch(0.984 0.006 283); --surface-3: oklch(0.963 0.009 283);
  --rail: oklch(0.215 0.075 277); --rail-2: oklch(0.175 0.075 277); --rail-text: oklch(0.76 0.04 280);
  --ink: oklch(0.245 0.03 285); --ink-2: oklch(0.39 0.025 285); --text-muted: oklch(0.53 0.02 285); --faint: oklch(0.66 0.016 285);
  --line: oklch(0.93 0.007 283); --line-2: oklch(0.89 0.009 283);
  --brand: oklch(0.42 0.205 268); --brand-ink: oklch(0.36 0.2 268); --brand-soft: oklch(0.952 0.05 275);
  --highlight: oklch(0.66 0.16 248); --highlight-ink: oklch(0.54 0.16 250); --highlight-soft: oklch(0.94 0.055 252);
}
.dark[data-dir="klein"] {
  --bg: oklch(0.175 0.025 280); --surface: oklch(0.218 0.027 280); --surface-2: oklch(0.248 0.027 280); --surface-3: oklch(0.275 0.027 280);
  --rail: oklch(0.15 0.04 278); --rail-2: oklch(0.125 0.04 278); --rail-text: oklch(0.72 0.03 280);
  --ink: oklch(0.95 0.01 285); --ink-2: oklch(0.8 0.015 285); --text-muted: oklch(0.66 0.018 285); --faint: oklch(0.55 0.018 285);
  --line: oklch(0.32 0.022 280); --line-2: oklch(0.38 0.022 280);
  --brand: oklch(0.62 0.19 270); --brand-ink: oklch(0.7 0.17 270); --brand-soft: oklch(0.31 0.08 274);
  --highlight: oklch(0.72 0.15 250); --highlight-ink: oklch(0.74 0.14 250); --highlight-soft: oklch(0.33 0.07 252);
}
```

- [ ] **Step 2: 追加 graphite/科技极简（设计稿 71/72 行）**

```css
/* ===== 科技极简 / graphite ===== */
[data-dir="graphite"] {
  --bg: oklch(0.982 0.003 220); --surface: oklch(1 0 0); --surface-2: oklch(0.98 0.003 220); --surface-3: oklch(0.96 0.004 220);
  --rail: oklch(0.2 0.008 220); --rail-2: oklch(0.16 0.008 220); --rail-text: oklch(0.72 0.006 220);
  --ink: oklch(0.21 0.008 225); --ink-2: oklch(0.38 0.006 225); --text-muted: oklch(0.52 0.006 225); --faint: oklch(0.66 0.005 225);
  --line: oklch(0.925 0.003 220); --line-2: oklch(0.88 0.004 220);
  --brand: oklch(0.53 0.115 210); --brand-ink: oklch(0.45 0.12 212); --brand-soft: oklch(0.95 0.04 208);
  --highlight: oklch(0.7 0.14 192); --highlight-ink: oklch(0.52 0.12 196); --highlight-soft: oklch(0.93 0.05 195);
}
.dark[data-dir="graphite"] {
  --bg: oklch(0.15 0.004 220); --surface: oklch(0.19 0.005 220); --surface-2: oklch(0.224 0.005 220); --surface-3: oklch(0.25 0.005 220);
  --rail: oklch(0.115 0.005 220); --rail-2: oklch(0.095 0.005 220); --rail-text: oklch(0.7 0.006 220);
  --ink: oklch(0.96 0.004 225); --ink-2: oklch(0.8 0.005 225); --text-muted: oklch(0.64 0.006 225); --faint: oklch(0.52 0.006 225);
  --line: oklch(0.29 0.005 220); --line-2: oklch(0.35 0.005 220);
  --brand: oklch(0.66 0.13 200); --brand-ink: oklch(0.72 0.12 200); --brand-soft: oklch(0.29 0.06 205);
  --highlight: oklch(0.78 0.14 188); --highlight-ink: oklch(0.8 0.13 188); --highlight-soft: oklch(0.3 0.06 192);
}
```

- [ ] **Step 3: 追加 warm/温暖亲和（设计稿 74/75 行）**

```css
/* ===== 温暖亲和 / warm ===== */
[data-dir="warm"] {
  --bg: oklch(0.985 0.009 75); --surface: oklch(0.997 0.004 75); --surface-2: oklch(0.982 0.011 72); --surface-3: oklch(0.96 0.015 70);
  --rail: oklch(0.265 0.03 50); --rail-2: oklch(0.225 0.03 50); --rail-text: oklch(0.75 0.025 60);
  --ink: oklch(0.265 0.022 58); --ink-2: oklch(0.4 0.02 58); --text-muted: oklch(0.525 0.018 58); --faint: oklch(0.655 0.016 62);
  --line: oklch(0.92 0.013 68); --line-2: oklch(0.88 0.015 66);
  --brand: oklch(0.55 0.13 46); --brand-ink: oklch(0.47 0.14 43); --brand-soft: oklch(0.955 0.035 58);
  --highlight: oklch(0.62 0.09 182); --highlight-ink: oklch(0.5 0.09 186); --highlight-soft: oklch(0.93 0.04 185);
}
.dark[data-dir="warm"] {
  --bg: oklch(0.192 0.013 52); --surface: oklch(0.232 0.014 52); --surface-2: oklch(0.262 0.014 52); --surface-3: oklch(0.288 0.014 52);
  --rail: oklch(0.152 0.015 48); --rail-2: oklch(0.128 0.015 48); --rail-text: oklch(0.73 0.022 58);
  --ink: oklch(0.952 0.008 62); --ink-2: oklch(0.8 0.012 62); --text-muted: oklch(0.66 0.015 60); --faint: oklch(0.56 0.015 60);
  --line: oklch(0.322 0.013 52); --line-2: oklch(0.38 0.013 52);
  --brand: oklch(0.68 0.13 50); --brand-ink: oklch(0.73 0.12 50); --brand-soft: oklch(0.32 0.05 46);
  --highlight: oklch(0.74 0.1 186); --highlight-ink: oklch(0.76 0.095 186); --highlight-soft: oklch(0.32 0.05 188);
}
```

- [ ] **Step 4: 追加 blue/经典蓝（设计稿 77/78 行）**

```css
/* ===== 经典蓝 / blue ===== */
[data-dir="blue"] {
  --bg: oklch(0.976 0.004 258); --surface: oklch(1 0 0); --surface-2: oklch(0.983 0.005 258); --surface-3: oklch(0.962 0.007 258);
  --rail: oklch(0.25 0.085 266); --rail-2: oklch(0.21 0.085 266); --rail-text: oklch(0.76 0.045 264);
  --ink: oklch(0.25 0.022 262); --ink-2: oklch(0.39 0.02 262); --text-muted: oklch(0.53 0.018 262); --faint: oklch(0.66 0.014 262);
  --line: oklch(0.93 0.006 258); --line-2: oklch(0.89 0.008 258);
  --brand: oklch(0.488 0.215 264); --brand-ink: oklch(0.43 0.215 264); --brand-soft: oklch(0.955 0.045 266);
  --highlight: oklch(0.62 0.17 250); --highlight-ink: oklch(0.52 0.17 252); --highlight-soft: oklch(0.94 0.055 255);
}
.dark[data-dir="blue"] {
  --bg: oklch(0.172 0.016 263); --surface: oklch(0.216 0.017 263); --surface-2: oklch(0.246 0.017 263); --surface-3: oklch(0.273 0.017 263);
  --rail: oklch(0.15 0.035 266); --rail-2: oklch(0.125 0.035 266); --rail-text: oklch(0.73 0.03 264);
  --ink: oklch(0.95 0.01 262); --ink-2: oklch(0.8 0.014 262); --text-muted: oklch(0.66 0.016 262); --faint: oklch(0.55 0.016 262);
  --line: oklch(0.31 0.018 263); --line-2: oklch(0.37 0.018 263);
  --brand: oklch(0.6 0.2 264); --brand-ink: oklch(0.67 0.18 264); --brand-soft: oklch(0.3 0.08 266);
  --highlight: oklch(0.7 0.16 252); --highlight-ink: oklch(0.72 0.15 252); --highlight-soft: oklch(0.32 0.07 255);
}
```

- [ ] **Step 5: 临时验证 4 方向（手动加属性）**

Run `pnpm --filter web dev`，在浏览器 devtools 给 `<html>` 临时加 `data-dir="klein"`（再试 graphite/warm/blue），目视底色/品牌色随之切换；切到 `.dark` 仍正确。确认后移除临时属性。

- [ ] **Step 6: 构建验证 + Commit**

```bash
pnpm --filter web build
git add packages/ui/src/styles/globals.css
git commit -m "feat(ui): 新增 klein/graphite/warm/blue 四套主题方向令牌"
```

---

## Task 4: ThemeProvider 增加方向（dir）维度

**Files:**
- Modify: `apps/web/src/components/theme-provider.tsx`
- Test: `apps/web/src/components/theme-provider.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/theme-provider.test.tsx`：
```tsx
// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { ThemeProvider, useTheme } from "./theme-provider"

function DirProbe() {
  const { dir, setDir } = useTheme()
  return (
    <div>
      <span data-testid="dir">{dir}</span>
      <button onClick={() => setDir("klein")}>klein</button>
    </div>
  )
}

describe("ThemeProvider dir 维度", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-dir")
  })
  afterEach(cleanup)

  it("默认 dir 为 petrol 并写入 data-dir", () => {
    render(
      <ThemeProvider>
        <DirProbe />
      </ThemeProvider>
    )
    expect(screen.getByTestId("dir").textContent).toBe("petrol")
    expect(document.documentElement.getAttribute("data-dir")).toBe("petrol")
  })

  it("setDir 更新属性并持久化", () => {
    render(
      <ThemeProvider>
        <DirProbe />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByText("klein"))
    expect(document.documentElement.getAttribute("data-dir")).toBe("klein")
    expect(localStorage.getItem("theme-dir")).toBe("klein")
  })

  it("初始化时读取已持久化的 dir", () => {
    localStorage.setItem("theme-dir", "warm")
    render(
      <ThemeProvider>
        <DirProbe />
      </ThemeProvider>
    )
    expect(screen.getByTestId("dir").textContent).toBe("warm")
    expect(document.documentElement.getAttribute("data-dir")).toBe("warm")
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm --filter web exec vitest run src/components/theme-provider.test.tsx
```
Expected: FAIL（`useTheme` 无 `dir`/`setDir`）。

- [ ] **Step 3: 实现 dir 维度**

在 `theme-provider.tsx`：
- 新增类型与常量：
```tsx
export type ThemeDir = "petrol" | "klein" | "graphite" | "warm" | "blue"
const THEME_DIRS: ThemeDir[] = ["petrol", "klein", "graphite", "warm", "blue"]
const DIR_STORAGE_KEY = "theme-dir"
function isThemeDir(v: string | null): v is ThemeDir {
  return v !== null && THEME_DIRS.includes(v as ThemeDir)
}
```
- `ThemeProviderState` 增加 `dir: ThemeDir; setDir: (d: ThemeDir) => void`。
- 在组件内：
```tsx
const [dir, setDirState] = React.useState<ThemeDir>(() => {
  const stored = localStorage.getItem(DIR_STORAGE_KEY)
  return isThemeDir(stored) ? stored : "petrol"
})
const setDir = React.useCallback((next: ThemeDir) => {
  localStorage.setItem(DIR_STORAGE_KEY, next)
  setDirState(next)
}, [])
React.useEffect(() => {
  // 复用现有 disableTransitionsTemporarily 抑制切方向时的全令牌过渡闪烁（spec §8.1）
  const restore = disableTransitionOnChange ? disableTransitionsTemporarily() : null
  document.documentElement.setAttribute("data-dir", dir)
  restore?.()
}, [dir, disableTransitionOnChange])
```
- `value` useMemo 加入 `dir, setDir`（依赖数组补 `dir, setDir`）。
- （可选）storage 跨窗口同步：在现有 `handleStorageChange` 同款逻辑里增加 `DIR_STORAGE_KEY` 分支调用 `setDirState`。

- [ ] **Step 4: 运行测试，确认通过**

Run:
```bash
pnpm --filter web exec vitest run src/components/theme-provider.test.tsx
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/theme-provider.tsx apps/web/src/components/theme-provider.test.tsx
git commit -m "feat(theme): ThemeProvider 增加主题方向 dir 维度(持久化+data-dir)"
```

---

## Task 5: 设置页「外观设置」新增方向选择

**Files:**
- Modify: `apps/web/src/components/settings/general-settings.tsx`

- [ ] **Step 1: 在外观卡内增加方向选择行**

在 `general-settings.tsx`：从 `useTheme()` 解构补 `dir, setDir`。在「外观设置」`<Card>` 的 `<CardContent>` 内、现有「浅色/深色/跟随系统」`<div className="grid grid-cols-3 gap-3">` **上方**，加入方向选择：
```tsx
const DIRS: { id: ThemeDir; label: string; swatch: string }[] = [
  { id: "petrol", label: "沉稳", swatch: "oklch(0.505 0.12 244)" },
  { id: "klein", label: "靛蓝", swatch: "oklch(0.42 0.205 268)" },
  { id: "graphite", label: "极简", swatch: "oklch(0.53 0.115 210)" },
  { id: "warm", label: "温暖", swatch: "oklch(0.55 0.13 46)" },
  { id: "blue", label: "经典", swatch: "oklch(0.488 0.215 264)" },
]
// ...
<div className="mb-4">
  <div className="mb-2 text-sm font-medium">主题方向</div>
  <div className="flex flex-wrap gap-2">
    {DIRS.map((d) => (
      <button
        key={d.id}
        type="button"
        onClick={() => setDir(d.id)}
        className={cn(
          "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm transition-colors hover:bg-accent/50",
          dir === d.id ? "border-primary bg-primary/5" : "border-transparent"
        )}
      >
        <span className="size-4 rounded-full" style={{ background: d.swatch }} />
        {d.label}
      </button>
    ))}
  </div>
</div>
```
顶部 import 补：`import { useTheme } from "@/components/theme-provider"`（已存在）+ `import type { ThemeDir } from "@/components/theme-provider"`，以及 `import { cn } from "@workspace/ui/lib/utils"`（若未引入）。

- [ ] **Step 2: 类型/lint 验证**

Run:
```bash
pnpm --filter web lint
```
Expected: 无新增报错。

- [ ] **Step 3: 人工冒烟**

`pnpm --filter web dev` → 设置页外观，点 5 个方向，应用即时换色并持久化（重启 dev 仍保持）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/general-settings.tsx
git commit -m "feat(settings): 外观设置新增 5 套主题方向选择器"
```

---

## Task 6: 母题件 `SectionHeader`

**Files:**
- Create: `packages/ui/src/components/section-header.tsx`
- Test: `apps/web/src/components/section-header.test.tsx`（新建，导入 `@workspace/ui`）

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/section-header.test.tsx`：
```tsx
// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach } from "vitest"
import { SectionHeader } from "@workspace/ui/components/section-header"

afterEach(cleanup)

describe("SectionHeader", () => {
  it("渲染标题", () => {
    render(<SectionHeader title="考核指标" />)
    expect(screen.getByText("考核指标")).toBeTruthy()
  })
  it("渲染 mono 大写小标签", () => {
    render(<SectionHeader title="工作台" tag="WORKBENCH" />)
    expect(screen.getByText("WORKBENCH")).toBeTruthy()
  })
  it("渲染右侧插槽", () => {
    render(<SectionHeader title="今日任务" right={<span>6 项</span>} />)
    expect(screen.getByText("6 项")).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm --filter web exec vitest run src/components/section-header.test.tsx
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现组件**

新建 `packages/ui/src/components/section-header.tsx`：
```tsx
import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

export interface SectionHeaderProps extends React.ComponentProps<"div"> {
  title: React.ReactNode
  tag?: string
  right?: React.ReactNode
  size?: "sm" | "md"
}

export function SectionHeader({
  title,
  tag,
  right,
  size = "md",
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn("flex items-center gap-2", right && "justify-between", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "shrink-0 rounded-sm bg-highlight",
            size === "md" ? "h-3.5 w-[3px]" : "h-3 w-[3px]"
          )}
        />
        <span
          className={cn(
            "font-semibold text-foreground",
            size === "md" ? "text-[13px]" : "text-xs"
          )}
        >
          {title}
        </span>
        {tag ? (
          <span className="font-mono text-[10px] tracking-wider text-faint uppercase">
            {tag}
          </span>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:
```bash
pnpm --filter web exec vitest run src/components/section-header.test.tsx
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/section-header.tsx apps/web/src/components/section-header.test.tsx
git commit -m "feat(ui): 新增 SectionHeader 母题件(accent 竖条+标题+mono 标签)"
```

---

## Task 7: 母题件 `StatusPill` + `PulseDot`

**Files:**
- Create: `packages/ui/src/components/status-pill.tsx`（含 `PulseDot` 具名导出）
- Test: `apps/web/src/components/status-pill.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/status-pill.test.tsx`：
```tsx
// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach } from "vitest"
import { StatusPill, PulseDot } from "@workspace/ui/components/status-pill"

afterEach(cleanup)

describe("StatusPill", () => {
  it("渲染文案", () => {
    render(<StatusPill variant="pos">实时同步</StatusPill>)
    expect(screen.getByText("实时同步")).toBeTruthy()
  })
  it("pulse 时含脉冲点", () => {
    const { container } = render(
      <StatusPill variant="pos" pulse>
        在线
      </StatusPill>
    )
    expect(container.querySelector(".animate-pulse-dot")).toBeTruthy()
  })
})

describe("PulseDot", () => {
  it("pulse 时带动画类", () => {
    const { container } = render(<PulseDot pulse />)
    expect(container.querySelector(".animate-pulse-dot")).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm --filter web exec vitest run src/components/status-pill.test.tsx
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现组件**

新建 `packages/ui/src/components/status-pill.tsx`：
```tsx
import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

type Variant = "pos" | "neg" | "neutral" | "highlight"

const DOT: Record<Variant, string> = {
  pos: "bg-pos",
  neg: "bg-destructive",
  neutral: "bg-muted-foreground",
  highlight: "bg-highlight",
}

const PILL: Record<Variant, string> = {
  pos: "bg-pos-soft text-pos",
  neg: "bg-neg-soft text-destructive",
  neutral: "bg-secondary text-muted-foreground",
  highlight: "bg-highlight-soft text-highlight-ink",
}

export function PulseDot({
  variant = "pos",
  pulse = false,
  className,
}: {
  variant?: Variant
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT[variant],
        pulse && "animate-pulse-dot",
        className
      )}
    />
  )
}

export interface StatusPillProps extends React.ComponentProps<"span"> {
  variant?: Variant
  pulse?: boolean
}

export function StatusPill({
  variant = "neutral",
  pulse = false,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium",
        PILL[variant],
        className
      )}
      {...props}
    >
      <PulseDot variant={variant} pulse={pulse} />
      {children}
    </span>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:
```bash
pnpm --filter web exec vitest run src/components/status-pill.test.tsx
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/status-pill.tsx apps/web/src/components/status-pill.test.tsx
git commit -m "feat(ui): 新增 StatusPill/PulseDot 母题件(状态胶囊+脉冲点)"
```

---

## Task 8: 外壳 restyle — 标题栏

**Files:**
- Modify: `apps/web/src/components/chat/shell/app-titlebar.tsx`

- [ ] **Step 1: 加品牌渐变徽标 + highlight 通知点**

在 `app-titlebar.tsx` 的品牌区（`<img src={logoSvg} .../>` 所在处，Windows 分支与 Mac 分支各一处），在 logo 旁包一个渐变方块徽标（保留原 logo 图也可，二选一；推荐渐变方块覆盖原 img）：
```tsx
<div className="relative flex size-[18px] items-center justify-center rounded-[6px] bg-gradient-to-br from-brand to-brand-ink shadow-sm">
  <img src={logoSvg} alt="" className="size-3" />
  <span className="absolute -right-[3px] -top-[3px] size-2 rounded-full border-[1.5px] border-background bg-highlight" />
</div>
```
标题文字 `<span>` 旁可加 mono 小标签（可选）：
```tsx
<span className="font-mono text-[10px] tracking-wider text-faint">BOBAN&nbsp;STAFF</span>
```

- [ ] **Step 2: 关闭按钮 hover 改令牌**

把关闭按钮 `hover:bg-red-500 hover:text-white` 改为 `hover:bg-destructive hover:text-white`。其余两个窗口按钮维持 `hover:bg-accent`（中性）。

- [ ] **Step 3: lint + 冒烟**

Run:
```bash
pnpm --filter web lint
```
`dev` 目视：标题栏左侧渐变徽标 + 通知点；关闭按钮 hover 为危险红；明暗/方向切换徽标随 brand 变化。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/shell/app-titlebar.tsx
git commit -m "feat(shell): 标题栏品牌渐变徽标 + highlight 通知点 + 关闭按钮令牌化"
```

---

## Task 9: 外壳 restyle — 导航 rail（深色，最显著）

**Files:**
- Modify: `apps/web/src/components/chat/shell/app-toolbar.tsx`

- [ ] **Step 1: 容器与默认前景改深色 rail**

把外层容器 `className` 的 `bg-muted/50` 改为 `bg-rail text-rail-text`：
```tsx
"flex h-full w-16 flex-col items-center border-r border-line-2/20 bg-rail py-3 text-rail-text",
```

- [ ] **Step 2: tab 按钮选中态 = highlight 竖条 + 白填充图标**

把 tab 渲染按钮的 `className` 与图标着色改为 rail 配色（rail 恒深，前景不随明暗翻转）：
```tsx
<Button
  variant="ghost"
  size="icon"
  className={cn(
    "relative size-10 rounded-lg text-rail-text hover:bg-white/10 hover:text-white",
    activeTab === tab.id && "bg-white/10 text-white"
  )}
  onClick={() => setActiveTab(tab.id)}
>
  {activeTab === tab.id ? (
    <>
      <span aria-hidden className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-sm bg-highlight" />
      <tab.iconFilled className="size-6 text-white" />
    </>
  ) : (
    <tab.icon className="size-6" />
  )}
  {/* 未读红点保持不变 */}
</Button>
```

- [ ] **Step 3: 底部铃铛/设置按钮改 rail 前景**

`NotificationBell` 外层若有色，设置按钮 `className` 改为 `size-10 rounded-lg text-rail-text hover:bg-white/10 hover:text-white`。用户头像区不动。

- [ ] **Step 4: lint + 冒烟**

Run:
```bash
pnpm --filter web lint
```
`dev` 目视：rail 在明亮模式也是深海军蓝；选中项左侧金色竖条 + 白色填充图标；hover 提亮；5 方向切换 rail 底色随之变化；未读红点仍可见。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chat/shell/app-toolbar.tsx
git commit -m "feat(shell): 导航 rail 改深海军蓝 + 选中 highlight 竖条/白填充图标"
```

---

## Task 10: 外壳 restyle — 状态栏

**Files:**
- Modify: `apps/web/src/components/app-status-bar.tsx`

- [ ] **Step 1: 整条 mono + 复用 PulseDot**

- 顶部 import：`import { PulseDot } from "@workspace/ui/components/status-pill"`。
- `<footer>` 的 `className` 增加 `font-mono`（保留现有 `h-7 ... text-[11px] text-muted-foreground` 等）。
- 把本文件内联的 `StatusDot` 替换为 `PulseDot`：在线段 `<PulseDot variant="pos" pulse />`；网络断开段 `<PulseDot variant="neg" />`（文案保留）。可删除本文件内的 `StatusDot` 定义。

- [ ] **Step 2: lint + 冒烟**

Run:
```bash
pnpm --filter web lint
```
`dev` 目视：状态栏数字/文案为 mono；在线点脉冲；交互（Popover 队列、串/并行跳转）不变。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/app-status-bar.tsx
git commit -m "feat(shell): 状态栏 mono 化 + 复用 PulseDot 脉冲点"
```

---

## Task 11: 收尾验证 + drop-in 母题采用

**Files:**
- Modify（可选 drop-in）：`apps/web/src/components/workbench/*`、对话内 message-blocks 中已有「竖条+标题」「状态文字」的就地替换为 `SectionHeader` / `StatusPill`（仅 drop-in，不改版式）

- [ ] **Step 1: 全量 lint**

Run:
```bash
pnpm lint
```
Expected: 无新增错误。

- [ ] **Step 2: 单测全跑**

Run:
```bash
pnpm --filter web test:unit
```
Expected: 新增的 theme-provider / section-header / status-pill 测试通过，且无既有用例回归。

- [ ] **Step 3: 构建**

Run:
```bash
pnpm --filter web build
```
Expected: 成功。

- [ ] **Step 4: 10 组合冒烟**

`pnpm --filter web dev`，5 方向 × 明暗逐一目视：rail 深色对比度、mono 数字、卡片阴影（`shadow-card`）、母题竖条/胶囊、状态脉冲、`hover:bg-accent` 是否自然。重点回归对话流与工作台不破版。

- [ ] **Step 5（可选）: drop-in 采用母题件**

在工作台/对话里把现成的「3px 竖条+标题」结构、状态文字就地替换为 `SectionHeader` / `StatusPill`（**仅当为等价替换、不动版式**）。每替换一处独立 commit。

- [ ] **Step 6: 完成提交**

```bash
git add -A
git commit -m "chore(ui): 视觉语言升级收尾(验证 + 母题 drop-in 采用)"
```

---

## 验证总结（完成判据）

- [ ] `pnpm lint` 干净；`pnpm --filter web build` 成功；`pnpm --filter web test:unit` 全绿。
- [ ] 5 方向 × 明暗 = 10 组合目视无错色/低对比/破版。
- [ ] 字体：界面 IBM Plex Sans、数字/时间戳/编号/状态栏为 IBM Plex Mono。
- [ ] rail 明亮模式仍深海军蓝、选中金竖条 + 白填充图标。
- [ ] 设置页可切 5 方向并持久化（重启保持）。
- [ ] 交互/版式零回归（换皮不换骨）。
