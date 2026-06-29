# 外观皮肤系统设计（借鉴 Proma 特殊风格）

日期：2026-06-29
状态：设计评审中

## 背景与目标

参考 `D:\code\personal-project\Proma-main` 的"外观设置"。Proma 的精髓是把外观拆成正交的几条轴，其中"特殊风格"是一组完整的、有调性的"皮肤"——每套皮肤把全部语义令牌重定义一遍，整个 app 协调换肤；选择 UX 用预览卡呈现。

Proma 基于 shadcn/ui + Tailwind **v3**（令牌存裸 HSL 通道，靠 `tailwind.config.js` 的 `hsl(var(--x))` 消费）。我们基于 Tailwind **v4**（CSS-first，`@theme inline` 把 `--color-*` 映射到裸 `--var`，令牌值是 **oklch**）。**不能照抄 Proma 的令牌格式与 config**，需做 v4 适配。

本设计**只借鉴"特殊风格"这一块**，不引入 Proma 的"经典/现代界面风格"、Markdown 字号等其它外观项（那属于更大的方向 C）。

### 明确的范围决定（来自用户）

1. **基础模式（浅色 / 深色 / 跟随系统）保持现状**，走现有靛蓝默认令牌，不动。
2. **删除**设置里现有的"主题色"accent 选择器（`国网绿` + `青蓝`两个预设，连同 `data-brand-theme` green/teal 的 CSS、`BRAND_THEMES` 数组、设置页那排色块）。
3. **国网绿不消失，升格成一套完整皮肤**，进入"特殊风格"。
4. 新增"特殊风格"区：一组皮肤卡，点选后整套换肤。

## 当前代码现状（事实基线）

- `packages/ui/src/styles/globals.css`：v4。`@theme inline` 映射 `--color-* → var(--*)`；`:root`（亮）+ `.dark`（暗）两套令牌，值为 oklch。已有 `:root[data-brand-theme="green"|"teal"]`（明/暗各一）**仅覆盖** `--primary / --sidebar-primary / --ring`（只换强调色，不是整套皮肤）。`@custom-variant dark (&:is(.dark *))`——dark 工具类只认 `.dark`。
- `apps/web/src/components/theme-provider.tsx`：管理 light/dark/system，往 `<html>` 加 `.light/.dark`，监听系统主题、跨窗口 storage、electron `onThemeChanged`；切换后调 `broadcastAppearanceChanged()`，并在收到变更时重 `applyBrandTheme(getStoredBrandTheme())`。
- `apps/web/src/lib/brand/brand-theme.ts`：`BRAND_THEMES`（default/green/teal）、`getStoredBrandTheme(fallback)`、`applyBrandTheme(id)`（写 `data-brand-theme` + localStorage `brand-theme` + 广播）。
- `apps/web/src/components/settings/general-settings.tsx`：外观卡 = 3 个模式卡（ThemeCard）+ 一排 brand 色块。
- `apps/web/src/main.tsx:36`：`applyBrandTheme(getStoredBrandTheme(brand.defaultTheme))`——首屏即应用，防 FOUC。
- `apps/web/branding/guowang/brand.json`：白标 `"defaultTheme": "green"`（国网包默认绿）。`apps/web/electron/shared/brand.ts`、`brand-config.ts`、`docs/field-deployment-manual.md`、`apps/web/branding/README.md` 都引用 `defaultTheme`。
- 全 app 硬编码背景（`bg-white/black/zinc-*/gray-*/...`、`bg-[#...]`）共 **22 处 / 12 文件**，多数是状态徽章、头像等**语义固定色**（本就该固定）；主壳层已吃 `bg-background/card/sidebar` 等语义令牌。

## 设计

### 1. 外观模型

单一外观状态，二选一：

- **基础模式**：浅色 / 深色 / 跟随系统。走现有靛蓝默认令牌（`:root` / `.dark`），无 `data-theme`。
- **特殊风格（皮肤）**：选中一套皮肤。每套皮肤自带"明/暗基调"。

交互规则（对齐 Proma 的"special 是第 4 种模式"，但我们把它独立成区）：

- 点选某皮肤 → 设 `data-theme=<id>`，并把 `<html>` 的 `.light/.dark` 设成该皮肤的基调；记忆基础模式不变但被皮肤覆盖。
- 点回 浅色/深色/系统 → 清掉 `data-theme`（回靛蓝默认），`.light/.dark` 按基础模式解析。

设置页"外观"区结构：

- `主题模式`：浅色 / 深色 / 跟随系统（三选一，**不要** Proma 的第 4 个"特殊风格" tab）。
- `特殊风格`：皮肤网格（独立小标题在上、卡片在下）。
- **不做**：经典/现代界面风格、界面缩放、Markdown 字号、应用图标选择器。

### 2. 换肤机制（v4 适配——本设计的工程核心）

- **挂载点**：`<html data-theme="<skin-id>">`（延续被删的 `data-brand-theme` 同款属性路子）。
- **皮肤定义**：每套皮肤 = `:root[data-theme="<id>"] { … }` 块，**重定义我们现有的令牌集**（不引入 Proma 的额外令牌词汇 `content-area/tabbar-surface/...`，把 Proma 调色板的意图映射到**我们已有的令牌**上）：

  需覆盖的令牌（即组件实际消费的那批）：
  `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --border --input --ring --sidebar --sidebar-foreground --sidebar-primary --sidebar-primary-foreground --sidebar-accent --sidebar-accent-foreground --sidebar-border --sidebar-ring`

  数据色板 `--chart-*` / `--wb-*`：皮肤默认**不覆盖**（沿用基调对应的亮/暗值），避免每套皮肤都要重调一遍图表色；如个别皮肤明显冲突，再单独补。（YAGNI）

- **颜色格式**：Proma 的 HSL 三元组 → **oklch**（与我们令牌一致）。转换在设计期完成，写死进 CSS。
- **深色皮肤同时打 `.dark`**：这样组件里成片的 `dark:` 工具类照常生效；皮肤令牌靠选择器特异性压过 `.dark`：
  - `.dark` → 特异性 (0,1,0)
  - `:root[data-theme="x"]` → (0,2,0) > (0,1,0)，**皮肤令牌赢**最终值，而 `dark:` 变体仍因 `.dark` 在 `<html>` 上而命中。
  - 亮色皮肤：打 `.light`、不打 `.dark`。
- **radius/shadow**：不照搬 Proma 的 `tailwind.config.js`。我们 v4 已有 `@theme` 的 radius 体系，皮肤**只覆盖颜色令牌**，不动圆角/阴影。
- **防闪烁**：`applyTheme` 用幂等写法——先算目标 class/attr，与当前 DOM 对比，一致则直接 return，避免无谓 mutation 引发的重级联（借鉴 Proma `applyThemeToDOM`）。

### 3. 皮肤集合 + 预览卡

**皮肤清单（8 套）**：

| id | 名称 | 基调 | 来源 |
|----|------|------|------|
| `guowang-green` | 国网绿 | light | 新设计，靛蓝→国网绿 |
| `slate-light` | 云朵舞者 | light | Proma 移植 |
| `ocean-light` | 晴空碧海 | light | Proma 移植 |
| `forest-light` | 森息晨光 | light | Proma 移植 |
| `ocean-dark` | 远山暮霭 | dark | Proma 移植 |
| `forest-dark` | 森息夜语 | dark | Proma 移植 |
| `slate-dark` | 莫兰迪夜 | dark | Proma 移植 |
| `terminal-dark` | 旧屏微光 | dark | Proma 移植 |

> 调色板很便宜，先全上；评审/实现期想砍随时砍。`terminal-dark` 的等宽字体/扫描线/闪烁等氛围特效**不移植**，只取其配色（避免引入动画与 reduced-motion 处理的额外复杂度）。

**预览卡：CSS 渲染的迷你 UI，不复用 Proma webp 插画。** 理由：① 我们自己的 `guowang-green` 没有对应插画，CSS 方案统一；② 公司产品里搬个人项目美术资源不妥；③ 迷你 UI 比抽象插画更如实反映"切了之后 app 长啥样"，且永远准、零资源维护。

预览卡结构（一个小组件 `SkinPreviewCard`）：在卡片内用一个 `data-theme=<id>` + 对应 `.light/.dark` 的隔离作用域（局部容器写属性，而非全局 html），渲染一小段假 UI——左侧细侧栏条 + 右侧 1-2 张卡 + 一个主色按钮 + 几行占位文字，全部吃该皮肤令牌。下方放皮肤中文名 + 选中打勾。

> 注意：`data-theme` 选择器现写在 `:root[...]` 上（全局）。为了让预览卡能在**局部**渲染任意皮肤，皮肤令牌块需**同时**支持局部作用域选择器。方案：皮肤令牌块选择器写成 `[data-theme="x"]`（去掉 `:root` 前缀也能命中 html，且能命中预览卡的局部容器）。但去掉 `:root` 会降低特异性到 (0,1,0)，与 `.dark` 平手 → 平手时后写者赢。**确保皮肤块在 CSS 中位于 `.dark` 之后**即可稳定取胜；或保留 `:root[data-theme=x]` 给全局、另写一份 `[data-theme=x]`（不带 :root）给预览容器。**采用前者**（统一 `[data-theme=x]`，靠源码顺序保证在 `.dark`/`.light` 之后），更简洁。该顺序约束在 CSS 里加注释固化。

### 4. 状态层与 plumbing 改造

新建 `apps/web/src/lib/theme/skins.ts`（替代 `lib/brand/brand-theme.ts` 的角色）：

```
export type SkinBasis = "light" | "dark"
export interface SkinOption { id: string; name: string; basis: SkinBasis }
export const SKINS: SkinOption[]          // 上表 8 套
export const SKIN_STORAGE_KEY = "appearance-skin"
export function getStoredSkin(fallback?): string   // "" / "default" 表示无皮肤
export function applySkin(id, opts?): void          // 写 data-theme + 调 .light/.dark + localStorage + 广播；id 为空/default 时清属性回基础模式
export function clearSkin(): void
```

- **复用现有 plumbing**：localStorage + `broadcastAppearanceChanged()` + electron `onThemeChanged` + `storage` 事件，与 `theme-provider` 的跨窗口同步逻辑一致。
- **与 ThemeProvider 的关系**：基础模式仍由 ThemeProvider 管（`.light/.dark`）。皮肤层在其之上：
  - 选皮肤：`applySkin` 直接 set `.light/.dark` 为皮肤基调（覆盖 ThemeProvider 当前态，但不改 ThemeProvider 存的 `theme` 值）。
  - 选基础模式（浅/深/系统）：先 `clearSkin()` 再让 ThemeProvider 应用模式。
  - 二者通过同一套广播/storage 事件保持多窗口一致。
- **首屏防 FOUC**：`main.tsx` 把 `applyBrandTheme(getStoredBrandTheme(brand.defaultTheme))` 换成 `applySkin(getStoredSkin(brand.defaultTheme))`——首屏即决定皮肤。

### 5. 白标 `defaultTheme` 向后兼容（关键）

- `apps/web/branding/guowang/brand.json` 的 `"defaultTheme": "green"` → 改为 `"defaultTheme": "guowang-green"`（国网包开机即进国网绿皮肤）。
- `getStoredSkin(fallback)` 的 fallback 接收 `brand.defaultTheme`：用户没选过皮肤时回退到品牌包指定皮肤。
- 旧值兼容：若 localStorage 里残留旧 `brand-theme` 值（`green`/`teal`/`default`）或 brand.json 仍写 `green`，做一次性映射：`green → guowang-green`、`teal → 无皮肤（青蓝已删，回靛蓝默认）`、`default → 无皮肤`。映射放在 `getStoredSkin` 里。
- 同步更新文档：`docs/field-deployment-manual.md`、`apps/web/branding/README.md` 里 `defaultTheme` 的取值说明（从"`default`/`green`/`teal`"改为皮肤 id 列表）。

### 6. 硬编码背景修正

- 全量复查那 22 处。**只改结构性表面**（会"不跟皮肤换"的容器底色，如某面板写死 `bg-white`/`bg-zinc-900`）→ 换成 `bg-background`/`bg-card`/`bg-muted` 等语义令牌。
- **不动**语义固定色：状态徽章（task-status-badge）、头像底色（contact-avatars）、HTML 产物渲染容器等——这些刻意固定，不应随皮肤变。
- 逐处判断写进实现计划，不在 spec 里预判全部。

## 单元边界（便于隔离与测试）

- `lib/theme/skins.ts`：纯状态/DOM 应用逻辑。输入皮肤 id，输出 DOM 属性/class + 持久化 + 广播。可单测（参照现有 `brand-theme.test.ts`）：存取、fallback、旧值映射、apply 清属性。
- `globals.css` 皮肤令牌块：纯声明，无逻辑。靠"源码顺序在 .dark 之后"的注释约束。
- `SkinPreviewCard`：纯展示组件，props = skin + selected + onSelect。局部 `data-theme` 作用域自渲染。
- `general-settings.tsx` 外观区：组装上述件 + 三模式卡。

## 测试策略

- `skins.test.ts`：getStoredSkin 默认/ fallback / 旧值映射；applySkin 设/清 data-theme 与 .light/.dark；clearSkin。
- 手测矩阵（重启后）：8 套皮肤逐一切换，验证侧栏/内容区/卡片/按钮/输入框/弹窗/代码块均协调换肤；深色皮肤下 `dark:` 工具类组件正常；切回浅/深/系统回靛蓝；多窗口（设置窗 vs 主窗）同步；国网白标包首屏直接国网绿。
- typecheck 注意：`apps/web` 的 `pnpm typecheck` 是空操作，真实检查用 `tsc -b`（见记忆 web-typecheck-is-noop）。

## 不做（YAGNI）

- 经典/现代界面风格、界面缩放、Markdown 字号、应用图标选择器。
- Proma 的额外令牌词汇（content-area/tabbar-surface/sidebar-control/code-bg/dialog/dashed-border/shadow-* 等）——除非映射到我们已有令牌时确有缺口。
- terminal 皮肤的扫描线/辉光/闪烁动画。
- 皮肤的明/暗双变体（每套皮肤单一基调；国网绿暂只做 light）。
- 复用 Proma 的 webp 预览插画。

## 风险与缓解

- **`.dark` 与 `[data-theme]` 特异性/顺序**：靠"皮肤块统一 `[data-theme=x]` 选择器 + 源码顺序在 `.dark` 之后"取胜；CSS 注释固化顺序约束。实现后用深色皮肤 + 大量 `dark:` 组件页面验证。
- **首屏 FOUC**：`main.tsx` 同步 applySkin，与现状 applyBrandTheme 同位置同时机，风险等同现状。
- **白标旧值**：一次性映射覆盖 localStorage 残留与 brand.json 旧值。
- **oklch 转换偏色**：Proma 调的是 HSL 观感，转 oklch 后亮度/彩度可能微偏；实现期逐套目视校准，必要时手调而非机械换算。
