# 视觉语言层升级 — 设计文档

- 日期：2026-06-25
- 范围：SP1（设计系统地基 + 外壳）+ SP2（多主题方向 + 切换器），合并为单一 spec
- 参照：`design/数字员工 工作台.dc.html`（Claude 设计的高保真 UI 稿）

## 1. 背景与目标

`design/` 下有一份完成度很高的视觉语言稿，气质比当前应用（shadcn 默认中性灰 + Raleway 单字体）成熟一个量级。我们要把这套视觉语言**整体移植到现有应用**，但**只换皮不换骨**：

- 全应用通过「设计令牌 + 字体」自动焕新约 80%；
- 剩余靠「外壳重构 + 母题复用件」补齐；
- **不重排任何屏的布局结构、不改交互流程、不动业务组件的 props/行为**。

目标产出：换上新令牌、双字体、深色导航 rail、核心视觉母题，并支持 5 套主题方向（沉稳/靛蓝/极简/温暖/经典）× 明暗，切换器落在设置页「外观」区。

## 2. 范围

### In scope
- 设计令牌：把设计稿 petrol/沉稳方向映射进现有 shadcn 变量，并补充缺失的新令牌层。
- 字体：IBM Plex Sans（界面拉丁/数字）+ IBM Plex Mono（数字/时间戳/编号/小标签），本地打包（`@fontsource`）。
- 核心母题复用件：`SectionHeader`（accent 竖条+标题）、`StatusPill`+脉冲点、mono 数字约定、mono 大写小标签、卡片阴影工具类。
- 外壳应用：标题栏（品牌徽标+accent 点）、导航 rail 改深海军蓝+选中竖条+填充图标、状态栏 mono 化+脉冲。
- 多主题：其余 4 套方向令牌（OKLCH 值直接从设计稿提取）。
- 切换器：扩展 `ThemeProvider` 支持「方向」维度；设置页「外观设置」卡新增方向选择。

### Out of scope（与「全量重构」的关键区别）
- ❌ 不重排工作台三栏、对话三段等任何屏的版式结构。
- ❌ 不改交互流程、不动组件 props/行为/数据流。
- ❌ 不逐个 redesign 业务组件——它们靠令牌+字体自动继承；母题只在「drop-in 即可」处顺手替换（区块标题、状态胶囊），不为像素对齐去改版式。
- ❌ 不换图标库（保留 Tabler；现有代码已用 `IconXxxFilled` 填充态，正好对上设计稿选中填充逻辑）。
- ❌ 不引入 Material Symbols。

## 3. 已敲定的设计决策（来自 brainstorm）

| 决策点 | 结论 |
|---|---|
| 改造档位 | 视觉语言层升级（换皮不换骨） |
| 字体 | 全套采用 IBM Plex Sans + Mono，数字走等宽 |
| 主题方向 | 全部 5 套 + 切换器 |
| 令牌接线 | 映射进现有 shadcn 变量 + 补充新层（不全面改命名） |
| 切换器位置 | 设置页「外观设置」 |
| 导航 rail | 采纳深色 rail（明亮模式下导航也是深海军蓝） |
| spec 粒度 | SP1+SP2 合并为一个 spec（纯视觉、无结构风险） |

## 4. 架构：设计令牌映射

设计稿用语义命名（`--bg/--surface/--rail/--ink/--line/--brand/--accent/--pos/--neg`…），现有代码用 shadcn 命名（`--background/--card/--muted/--border/--primary/--accent/--destructive`…）。策略：**能复用的复用，缺的补，冲突的化解**。

### 4.1 复用（把设计稿 petrol 值写进现有变量）

| 设计稿令牌 | 映射到现有 shadcn 变量 | 说明 |
|---|---|---|
| `--bg` | `--background` | 页面底色 |
| `--surface` | `--card` / `--popover` | 白色卡面 |
| `--ink` | `--foreground` | 主文字 |
| `--muted`（设计=中灰文字） | `--muted-foreground` | ⚠️ 文字色，非背景 |
| `--line` | `--border` | 描边 |
| `--brand` | `--primary` | 品牌主色（petrol 后 primary 由蓝变沉稳青蓝） |
| `--neg`（设计=红） | `--destructive` | 危险/失败 |

### 4.2 新增令牌（设计稿独有，现有体系没有）

在 `:root` / `.dark` 中新增，并在 `@theme inline` 暴露为 Tailwind 颜色（按需）：

- 表面层级：`--surface-2`、`--surface-3`（次级表面、输入/进度槽底）
- 导航 rail：`--rail`、`--rail-2`、`--rail-text`（深海军蓝及其前景）
- 文字层级：`--ink-2`（次级文字）、`--faint`（最弱文字/时间戳）
- 描边：`--line-2`（强描边/分隔）
- 品牌延伸：`--brand-ink`（深一档，做渐变/hover）、`--brand-soft`（淡底）
- 状态绿：`--pos`、`--pos-soft`
- 危险淡底：`--neg-soft`
- 阴影：`--shadow`、`--shadow-lg`

### 4.3 命名冲突化解（关键）

设计稿 `--accent`（金色高亮，用于竖条/徽章/选中标记）与 shadcn `--accent`（中性 hover 背景，全应用 `hover:bg-accent` 大量使用）**语义不同**。

**决策**：保留 shadcn `--accent`/`--accent-foreground` 原义（中性 hover），把设计稿的金色高亮引入为**全新 `highlight` 族**：
- `--highlight`（金色，对应设计 `--accent`）
- `--highlight-ink`（深金，对应设计 `--accent-ink`，文字/图标）
- `--highlight-soft`（淡金底，对应设计 `--accent-soft`，徽章背景）

在 `@theme inline` 暴露为 `highlight` / `highlight-soft` 等 Tailwind 颜色，供母题件使用。

同理 `--neg`/`--neg-soft`：`--neg` 复用 `--destructive`，`--neg-soft` 为新增；母题件统一引用 `--destructive` + `--neg-soft`，不再引入第二个红色。

### 4.4 主题方向 token 组织

- **基线 = petrol/沉稳**：写进默认 `:root`（light）与 `.dark`（dark），即上面 4.1–4.3 的值。`data-dir` 缺省或 `petrol` 时生效。
- **其余 4 方向**：按属性选择器叠加覆盖，值从设计稿第 68/69（klein）、71/72（graphite）、74/75（warm）、77/78（blue）行逐字提取：
  ```css
  [data-dir="klein"]      { /* light 覆盖 */ }
  .dark[data-dir="klein"] { /* dark 覆盖 */ }
  /* graphite / warm / blue 同构 */
  ```
- 现有 Tailwind dark variant 为 `&:is(.dark *)`（class 制），方向用 `data-dir` 属性，二者正交、互不干扰。

## 5. 字体系统

- 依赖：新增 `@fontsource/ibm-plex-sans` 与 `@fontsource/ibm-plex-mono`（静态权重；按需 import 400/500/600），在 `packages/ui/src/styles/globals.css` 顶部 `@import`。移除/保留 lora 视实际使用而定（保留不影响）。
- 变量改写（`@theme inline`）：
  - `--font-sans: 'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif;`（拉丁/数字走 Plex，中文回退系统字体——与设计稿一致）
  - 新增 `--font-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace;`，暴露为 Tailwind `font-mono`。
- **mono 使用约定**（写入母题件 + 文档，不强制全量改造）：数字、时间戳、编号（如 `#18`）、工号、版本号、大写小标签一律 `font-mono`。母题件内建，业务侧 drop-in 时顺带。

## 6. 核心母题复用件

新增到 `packages/ui/src/components/`（共享层），保持单一职责、可独立测试：

### 6.1 `SectionHeader`
区块标题 = 3px `highlight` 竖条 + 标题文字 + 可选右侧插槽（mono 计数/大写标签）。
- props：`title: string`、`tag?: string`（mono 大写小标签）、`right?: ReactNode`、`size?: "sm" | "md"`。
- 用途：工作台各区块标题、对话内卡片标题。

### 6.2 `StatusPill`
状态胶囊 = 圆点（可脉冲）+ 文案，配色按状态。
- props：`variant: "pos" | "neg" | "neutral" | "highlight"`、`pulse?: boolean`、`children`。
- 复用 `--pos/--pos-soft`、`--destructive/--neg-soft`、`--muted/--surface-3`、`--highlight*`。
- 用途：实时同步、在线、执行中、成功/已取消、TOP 标记。

### 6.3 辅助
- `PulseDot`（被 StatusPill 内用，也可独立用于状态栏）：脉冲圆点；动画 `@keyframes`（pulse）加到 globals.css。
- 阴影工具类：在 `@theme inline` 暴露 `--shadow`/`--shadow-lg` 为 `shadow-card` / `shadow-float`（或直接 `shadow-[var(--shadow)]`，二选一，倾向工具类便于复用）。
- 卡片：**不新建组件**——设计稿卡片观感主要来自令牌（border + shadow + radius）。现有 shadcn `Card` 接令牌后自动到位；仅在 globals 校准 `--radius` 与卡片默认阴影。

> YAGNI：不抽 `MonoNumber`、不抽 `Card` 变体；约定 + 现有件足够。

## 7. 外壳应用（restyle，不改结构）

### 7.1 `app-titlebar.tsx`
- 维持 36px 高度与窗口控制结构不变。
- 品牌区：在 logo 旁增设计稿的渐变方块徽标（`linear-gradient(--brand→--brand-ink)`）+ 右上 `--highlight` 通知点；标题旁可选 mono 大写小标签（如 `BOBAN STAFF`）。
- 关闭按钮 hover 用 `--destructive`。

### 7.2 `app-toolbar.tsx`（导航 rail）— 最显著变化
- 容器底色 `bg-muted/50` → `bg-[var(--rail)]`（深海军蓝，明暗都深）。
- rail 内图标/文字默认色 → `--rail-text`；hover/选中前景提亮为白。
- 选中态：左侧 3px `--highlight` 竖条 + 图标填充白（`IconXxxFilled`）+ 轻微高亮底（`rgba(255,255,255,.09)`）。
- 因 rail 恒为深色，rail 内前景**不随明暗翻转**，需独立配色（不复用 `foreground`）。
- 未读红点、设置、通知铃保持位置与行为。

### 7.3 `app-status-bar.tsx`
- 整条 `font-mono`，字号沿用。
- 在线/网络点改用 `PulseDot`（pos 脉冲）。
- 版本号/授权天数等沿用，靠 `--faint`。
- 内容与交互（Popover 队列、跳转）完全不动。

## 8. 多主题方向 + 切换器

### 8.1 扩展 `ThemeProvider`（`theme-provider.tsx`）
- 新增并行维度 `dir: ThemeDir`（`"petrol" | "klein" | "graphite" | "warm" | "blue"`），默认 `petrol`。
- `setDir(dir)`：持久化到 `localStorage`（key `theme-dir`），并把 `data-dir` 属性写到 `document.documentElement`。
- 复用现有 light/dark/system 逻辑（class 制），互不影响；context 暴露 `{ theme, setTheme, dir, setDir }`。
- 沿用现有 storage 跨窗口同步与 `disableTransitionsTemporarily` 抑制切换闪烁。

### 8.2 设置页「外观设置」卡（`general-settings.tsx`）
- 在现有「浅色/深色/跟随系统」上方新增「主题方向」一行：5 个色板卡（复用 `ThemeCard` 或新增轻量 swatch，展示各方向品牌色 + 名称）。
- 选中即 `setDir`，即时生效、持久化。
- 其余设置项不动。

## 9. 影响面（文件清单）

新增：
- `packages/ui/src/components/section-header.tsx`
- `packages/ui/src/components/status-pill.tsx`（含 `PulseDot`）
- （可选）色板 swatch 组件 / 复用 `theme-card.tsx`

改动：
- `packages/ui/src/styles/globals.css`（令牌 4.x、字体 5、5 方向 token、pulse keyframes、阴影工具）
- `packages/ui/package.json`（新增 `@fontsource/ibm-plex-sans`、`@fontsource/ibm-plex-mono`）
- `apps/web/src/components/theme-provider.tsx`（dir 维度）
- `apps/web/src/components/chat/shell/app-titlebar.tsx`
- `apps/web/src/components/chat/shell/app-toolbar.tsx`
- `apps/web/src/components/app-status-bar.tsx`
- `apps/web/src/components/settings/general-settings.tsx`（+ 可能 `theme-card.tsx`）

继承式自动焕新（**不主动改**，靠令牌/字体生效）：工作台、对话、联系人、技能、设置、各右侧面板、所有 message-blocks 与 widgets。

## 10. 测试与验证

- **单测**：`SectionHeader`、`StatusPill` 渲染/变体快照与基本 props（沿用现有 vitest + RTL 模式，与 `draggable-workbench-grid.test.tsx` 等同构）。`theme-provider` 的 dir 持久化/属性写入测试。
- **类型/构建**：`pnpm lint`；用 `tsc -b`（注意 `apps/web` 的 `pnpm typecheck` 是空操作）做真实类型检查；`pnpm build --filter=@workspace/ui`。
- **人工冒烟**：5 方向 × 明暗 = 10 组合逐一目视；重点看 rail 深色对比度、mono 数字、卡片阴影、母题竖条、状态脉冲；切换持久化（重启应用保持）。
- **回归关注**：`hover:bg-accent` 全局 hover 在新令牌下是否仍自然（因 `--accent` 保持原义，预期无碍）。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 令牌命名冲突误改全局 hover | 严守 4.3：`--accent` 不动，金色走新 `highlight` 族 |
| petrol 设为默认改变 primary 色，影响既有强调处 | 这是预期的整体焕新；冒烟逐屏确认无突兀 |
| rail 深色后内部前景对比不足 | rail 前景独立配色，不复用 foreground；冒烟查对比度 |
| IBM Plex 不含中文，CJK 回退 | font-stack 显式回退 PingFang/YaHei，与设计稿一致 |
| 字体打包增大体积 | 仅引 400/500/600 三档 + 按需，mono 同理 |
| 5 方向 OKLCH 提取出错 | 逐字对照设计稿行号；10 组合冒烟兜底 |

## 12. 内部实现阶段（供后续 writing-plans 细化）

1. **令牌 + 字体地基**：globals.css 令牌映射/新增、字体依赖与变量、pulse keyframes、阴影工具。（无可视回归前先建好底座）
2. **母题复用件**：`SectionHeader`、`StatusPill`/`PulseDot` + 单测。
3. **外壳应用**：titlebar / rail（深色）/ statusbar 三处 restyle。
4. **多方向 token**：klein/graphite/warm/blue × 明暗，从设计稿提取。
5. **切换器**：ThemeProvider dir 维度 + 设置页外观区。
6. **收尾**：lint / tsc -b / build；10 组合冒烟；按需把工作台/对话里 drop-in 的区块标题、状态胶囊替换为母题件。
