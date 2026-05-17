# 桌面宠物 Petdex/Codex 标准化改造 PRD

> 版本：v2.0 | 日期：2026-05-17 | 状态：全部 Phase 已完成

## 1. 问题陈述

### 1.1 现状

当前宠物系统使用一套自定的动画格式：

```
apps/web/src/components/pet/skins/default/
├── manifest.json      ← 自定格式：frameWidth/frameHeight/columns/animations/fps
└── sprite.png         ← 2048×1536 PNG，8列×6行，256×256 帧
```

```typescript
// animation/types.ts — 6 个自定状态
type PetState = "idle" | "listening" | "thinking" | "acting" | "speaking" | "error"

// animation/manifest.ts — 自定动画配置
type SpriteAnimation = { from: number; to: number; fps: number; loop: boolean }
type SpriteSkinManifest = {
  id: string; name: string; type: "sprite"; image: string;
  frameWidth: number; frameHeight: number; columns: number;
  scale: number; defaultAnimation: PetState;
  animations: Partial<Record<PetState, SpriteAnimation>>
}
```

静态导入皮肤：
```typescript
import manifestData from "./skins/default/manifest.json"
import spritePng from "./skins/default/sprite.png"
```

### 1.2 痛点

| # | 问题 | 影响 |
|---|------|------|
| 1 | **自定格式不兼容生态** | 无法使用 Petdex 市集 2000+ 个社区宠物 |
| 2 | **自定义宠物成本高** | 需要手写 `manifest.json` 配 `from/to/fps`，没有工具链支持 |
| 3 | **静态导入** | 皮肤写死，用户无法切换宠物 |
| 4 | **PNG 体积大** | 相比 WebP 大 2-3 倍 |
| 5 | **256×256 帧浪费** | 大量空白像素，实际内容远小于帧尺寸 |

### 1.3 机会

Petdex（Codex 宠物市集）已定义成熟标准：
- **1536×1872 WebP spritesheet**，8列×9行 grid，192×208 帧
- **9 标准状态**按行固定，每帧独立 duration
- **`pet.json` 极简格式**，动画 layout 是共享约定
- **CLI 工具链**：`npx petdex install` / `npx petdex hatch`
- **2000+ 社区宠物**可直接使用

---

## 2. 实现架构

### 2.1 架构对比

```
  ┌──── 改造前 ────────────────────────────────────────────┐
  │                                                         │
  │  skins/default/                                          │
  │  ├── manifest.json  ──┐                                  │
  │  └── sprite.png       │                                  │
  │       ↓               ↓                                  │
  │  manifest.ts ──→ SpriteAnimation (fps)                   │
  │       ↓                                                  │
  │  SpritePlayer (canvas, 统一 fps)                          │
  │       ↓                                                  │
  │  PetWindow (静态 import, 写死 default)                    │
  │                                                         │
  └─────────────────────────────────────────────────────────┘

  ┌──── 改造后 ────────────────────────────────────────────┐
  │                                                         │
  │  内置皮肤 (编译时)              Petdex 皮肤 (运行时)      │
  │  ┌──────────────────┐          ┌──────────────────┐     │
  │  │ skins/<slug>/    │          │ ~/.codex/pets/   │     │
  │  │ ├── pet.json     │          │ <slug>/          │     │
  │  │ └── sprite.webp  │          │ ├── pet.json     │     │
  │  └──────┬───────────┘          │ └── sprite.webp  │     │
  │         │                      └──────┬───────────┘     │
  │         ▼                             ▼                 │
  │  import.meta.glob            petdex:// 自定义协议        │
  │  (Vite 构建时发现)            (Electron protocol.handle) │
  │         │                             │                 │
  │         └──────────┬──────────────────┘                 │
  │                    ▼                                    │
  │  pet-loader.ts (统一接口)                                │
  │  ├── listBundledSkins()  → 同步，Vite glob               │
  │  ├── loadInstalledSkinList() → 异步，合并 bundled+petdex │
  │  └── loadPetSkin(slug)   → bundled→petdex fallback      │
  │                    │                                    │
  │                    ▼                                    │
  │  createPetSkin(meta, imageSrc)                          │
  │  → 按 9-state grid 约定推导动画参数                       │
  │  → 返回 { meta, image, animations }                     │
  │                    │                                    │
  │                    ▼                                    │
  │  SpritePlayer (canvas, durations[] 驱动)                 │
  │  drawFrame: 源坐标 = (frameIndex % 8) * 192             │
  │                      floor(frameIndex / 8) * 208        │
  │                    │                                    │
  │                    ▼                                    │
  │  PetWindow (运行时加载, IPC 切换)                        │
  │  ├── onPetChanged 监听 → 实时切换皮肤                    │
  │  ├── 双击触发 running/running-left/running-right 随机   │
  │  ├── feedback.variant 映射:                              │
  │  │   success → jumping (非循环, 播完回 idle)             │
  │  │   error   → failed                                   │
  │  │   info    → waving                                   │
  │  │   record  → waving                                   │
  │  │   busy    → waiting                                   │
  │  └── 语音气泡 + 状态标签                                 │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

```
  ┌──── IPC 通信流 ─────────────────────────────────────────┐
  │                                                         │
  │  设置页 (settings-page.tsx)         宠物窗 (PetWindow)   │
  │        │                                    │           │
  │        │  pet:select(slug)                  │           │
  │        ├─────────────────────► main process │           │
  │        │                      │             │           │
  │        │               ┌──────┴──────┐      │           │
  │        │               │ setSetting  │      │           │
  │        │               │ ("selected  │      │           │
  │        │               │  PetSlug",  │      │           │
  │        │               │  slug)      │      │           │
  │        │               └──────┬──────┘      │           │
  │        │                      │             │           │
  │        │               pet-changed(slug)    │           │
  │        │                      ├───────────► │           │
  │        │                      │             │           │
  │        │                      │  loadPetSkin(slug)      │
  │        │                      │  → setCurrentSkin       │
  │        │                      ▼             ▼           │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

### 2.2 自定义协议 (petdex://)

```
  ┌──── Electron main process ──────────────────────────┐
  │                                                     │
  │  app.whenReady:                                      │
  │  ┌─────────────────────────────────────────────┐    │
  │  │ protocol.handle("petdex", (request) => {    │    │
  │  │   const slug = url.hostname                  │    │
  │  │   const file = url.pathname                  │    │
  │  │   const fullPath = path.resolve(             │    │
  │  │     os.homedir(), ".codex", "pets",          │    │
  │  │     slug, file)                               │    │
  │  │   // 路径穿越防护: path.relative 检查          │    │
  │  │   return net.fetch(pathToFileURL(fullPath))   │    │
  │  │ })                                            │    │
  │  └─────────────────────────────────────────────┘    │
  │                                                     │
  │  Renderer process:                                   │
  │  img.src = "petdex://eve/spritesheet.webp"          │
  │           ↓                                         │
  │       file:///Users/foo/.codex/pets/eve/            │
  │                    spritesheet.webp                 │
  │                                                     │
  └─────────────────────────────────────────────────────┘
```

### 2.3 删除的组件

- `manifest.json` 自定格式 — `pet.json` 替代
- `SprintSkinManifest.type` — 不再需要（只有 sprite 一种类型）
- `SprintAnimation.fps` — `durations[]` 替代
- `SprintSkinManifest.frameWidth/frameHeight/columns` — 从 grid 约定推导
- `SprintSkinManifest.scale/autoAlign/defaultAnimation` — 统一处理
- 静态 `import` 皮肤 — 运行时动态加载
- PNG spritesheet — WebP 替代
- `skins/default/` 整个目录 — 废弃

### 2.4 保留的组件

| 组件 | 说明 |
|------|------|
| `SpritePlayer` | Canvas 渲染逻辑保留，帧推进算法修改 |
| `PetWindow` | 交互逻辑（拖拽、语音气泡）不变 |
| `usePetVoiceCurator` | 语音功能不变 |
| `PetWindow.css` | 样式基本不变 |
| Electron 宠物窗口管理 | 创建/显示/隐藏/置顶不变 |

---

## 3. 详细设计

### 3.1 Petdex/Codex 标准规范（不可协商）

#### Spritesheet 布局

```
1536 px (8列 × 192px)
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │ 7  │  row 0: idle (6帧, 空2格)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 8  │ 9  │ 10 │ 11 │ 12 │ 13 │ 14 │ 15 │  row 1: running-right (8帧)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 16 │ 17 │ 18 │ 19 │ 20 │ 21 │ 22 │ 23 │  row 2: running-left (8帧)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 24 │ 25 │ 26 │ 27 │ 28 │ 29 │ 30 │ 31 │  row 3: waving (4帧, 空4格)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 32 │ 33 │ 34 │ 35 │ 36 │ 37 │ 38 │ 39 │  row 4: jumping (5帧, 空3格)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 40 │ 41 │ 42 │ 43 │ 44 │ 45 │ 46 │ 47 │  row 5: failed (8帧)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 48 │ 49 │ 50 │ 51 │ 52 │ 53 │ 54 │ 55 │  row 6: waiting (6帧, 空2格)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 56 │ 57 │ 58 │ 59 │ 60 │ 61 │ 62 │ 63 │  row 7: running (6帧, 空2格)
├────┼────┼────┼────┼────┼────┼────┼────┤
│ 64 │ 65 │ 66 │ 67 │ 68 │ 69 │ 70 │ 71 │  row 8: review (6帧, 空2格)
└────┴────┴────┴────┴────┴────┴────┴────┘
1872 px (9行 × 208px)
```

#### 9 标准状态定义

```typescript
type PetState =
  | "idle"          // row 0: 6帧, durations [280,110,110,140,140,320]          — 待机
  | "running-right" // row 1: 8帧, durations [120,120,120,120,120,120,120,220] — 行动/右侧
  | "running-left"  // row 2: 8帧, durations [120,120,120,120,120,120,120,220] — 行动/左侧
  | "waving"        // row 3: 4帧, durations [140,140,140,280]                 — 交互/打招呼
  | "jumping"       // row 4: 5帧, durations [140,140,140,140,280]             — 成功/兴奋
  | "failed"        // row 5: 8帧, durations [140,140,140,140,140,140,140,240] — 错误/失败
  | "waiting"       // row 6: 6帧, durations [150,150,150,150,150,260]         — 等待/思考
  | "running"       // row 7: 6帧, durations [120,120,120,120,120,220]         — 通用行动
  | "review"        // row 8: 6帧, durations [150,150,150,150,150,280]         — 审查/检查
```

未使用的格子必须完全透明。

#### pet.json 格式

```json
{
  "id": "wall-e-baby",
  "displayName": "Wall-E Baby",
  "description": "A tiny baby Wall-E companion based on the cute first-pass purple reference.",
  "spritesheetPath": "sprite.webp"
}
```

无其他字段。动画信息通过上述 grid 约定硬编码推导。

### 3.2 类型定义 (`animation/types.ts`)

```typescript
export type PetState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review"

export const PET_STATES: PetState[] = [
  "idle", "running-right", "running-left", "waving", "jumping",
  "failed", "waiting", "running", "review",
]

/** 每行标准帧数 */
export const PET_FRAMES_PER_ROW: Record<PetState, number> = {
  idle: 6,
  "running-right": 8,
  "running-left": 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6,
}

/** 每行标准 frame durations (ms) */
export const PET_DURATIONS: Record<PetState, number[]> = {
  idle: [280, 110, 110, 140, 140, 320],
  "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
  "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280],
  jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220],
  review: [150, 150, 150, 150, 150, 280],
}

export const PET_STATE_LABELS: Record<PetState, string> = {
  idle: "待命中",
  "running-right": "执行中",
  "running-left": "执行中",
  waving: "互动中",
  jumping: "已完成",
  failed: "出错了",
  waiting: "思考中",
  running: "运行中",
  review: "审查中",
}

/** Petdex/Codex 标准 spritesheet 常量 */
export const PET_SHEET_COLS = 8
export const PET_SHEET_FRAME_W = 192
export const PET_SHEET_FRAME_H = 208
```

### 3.3 Pet 加载器 (`pet-loader.ts`)

```typescript
// === 类型定义 ===
export type PetMeta = {
  id: string
  displayName: string
  description: string
  spritesheetPath: string  // 对应 pet.json 中的字段
}

export type PetFrameAnimation = {
  row: number       // row index (0-8)
  from: number      // start frame index in spritesheet
  to: number        // end frame index
  durations: number[]  // per-frame ms
  loop: boolean
}

export type PetSkin = {
  meta: PetMeta
  image: string     // resolved URL (Vite asset URL 或 petdex://)
  animations: Record<PetState, PetFrameAnimation>
}

export type PetSkinInfo = {
  slug: string
  displayName: string
  description: string
  source: "bundled" | "petdex"  // 来源标记
}

// === 内置皮肤发现 (编译时) ===
const metaModules = import.meta.glob<{ default: PetMeta }>(
  "./skins/*/pet.json", { eager: true },
)

const imageModules = import.meta.glob<string>(
  "./skins/*/*.webp",
  { eager: true, query: "?url", import: "default" },
)

// === 统一创建 PetSkin (9-state grid 约定推导) ===
export function createPetSkin(meta: PetMeta, imageSrc: string): PetSkin {
  const animations = {} as Record<PetState, PetFrameAnimation>
  for (let i = 0; i < PET_STATES.length; i++) {
    const state = PET_STATES[i]
    const frameCount = PET_FRAMES_PER_ROW[state]
    const from = i * PET_SHEET_COLS
    animations[state] = {
      row: i,
      from,
      to: from + frameCount - 1,
      durations: PET_DURATIONS[state],
      loop: state !== "jumping",  // jumping 非循环
    }
  }
  return { meta, image: imageSrc, animations }
}

// === 列表查询 ===
export function listBundledSkins(): PetSkinInfo[]  // 同步，内置

export async function loadInstalledSkinList(): Promise<PetSkinInfo[]>
  // 异步，合并 bundled + 通过 IPC 获取 Petdex 列表

// === 加载具体皮肤 ===
export async function loadPetSkin(slug: string): Promise<PetSkin>
  // 1. 先查内置 (metaModules)
  // 2. 未命中 → IPC getPetdexMeta, 构造 petdex:// URL
```

### 3.4 SpritePlayer 改造 (`animation/SpritePlayer.tsx`)

从 `createPetSkin` 生成的 `animations` 直接消费，消除内部推导：

```typescript
type SpritePlayerProps = {
  animationName: PetState
  animations: Record<PetState, PetFrameAnimation>  // ← 从 PetSkin 传入
  image: string
  scale: number
  autoAlign?: boolean
  onAnimationComplete?: () => void
}

// SpritePlayer 内部
const animation = animations[animationName]  // ← 直接查表，不再推导
```

帧推进算法使用 `animation.durations[]` 驱动，`loop` 属性来自皮肤定义：

```typescript
function tick(timestamp: number) {
  frameElapsedMs += timestamp - lastTimestamp
  lastTimestamp = timestamp

  while (frameCursor < frameCount) {
    const dur = animation.durations[frameCursor] ?? 100
    if (frameElapsedMs < dur) break
    frameElapsedMs -= dur
    frameCursor++
  }

  if (frameCursor >= frameCount) {
    if (animation.loop) { frameCursor = 0; frameElapsedMs = 0 }
    else { frameCursor = frameCount - 1; onAnimationComplete?.() }
  }

  drawFrame(animation.from + frameCursor)
  animationFrame = window.requestAnimationFrame(tick)
}
```

`drawFrame` 使用标准常量计算源坐标：

```typescript
function drawFrame(frameIndex: number) {
  const sourceX = (frameIndex % PET_SHEET_COLS) * PET_SHEET_FRAME_W
  const sourceY = Math.floor(frameIndex / PET_SHEET_COLS) * PET_SHEET_FRAME_H
  // drawImage 使用 192×208 帧尺寸
}
```

### 3.5 Petdex 自定义协议 (`petdex://`)

Electron 主进程注册，将 `petdex://<slug>/<file>` 映射到 `~/.codex/pets/<slug>/<file>`：

```
  protocol.handle("petdex", (request) => {
    const url = new URL(request.url)
    const slug = url.hostname
    const file = path.normalize(url.pathname.replace(/^\//, ""))
    const fullPath = path.resolve(homedir, ".codex", "pets", slug, file)
    // 路径穿越防护: 检查 relative 不包含 ..
    return net.fetch(pathToFileURL(fullPath).href)
  })
```

跨平台兼容：
- Windows: `pathToFileURL()` 生成正确 `file:///C:/Users/...` 格式
- Linux/macOS: `path.relative()` 路径穿越防护大小写安全

### 3.6 PetWindow 状态映射

| 应用事件 | 触发时机 | Petdex 状态 |
|---------|---------|-------------|
| 默认无操作 | — | `idle` |
| 录音中 | `isRecording === true` | `waving` |
| 语音处理中 | `voiceBusy === true` | `waiting` |
| 成功反馈 | `feedback.variant === "success"` | `jumping` |
| 错误反馈 | `feedback.variant === "error"` | `failed` |
| 信息提示 | `feedback.variant === "info"` | `waving` |
| 双击 | 400ms 内双击且 idle | `running` / `running-left` / `running-right` 随机 |

### 3.7 Electron IPC 宠物选择

```
  settings-page               main process               PetWindow
     │                            │                         │
     │── pet:select(slug) ──────► │                         │
     │                            ├── setSetting()          │
     │                            ├── pet-changed(slug) ──► │
     │                            │                         ├── loadPetSkin(slug)
     │                            │                         └── setCurrentSkin()
     │                            │                         │
     │── pet:list-petdex ───────► │                         │
     │◄── PetSkinInfo[]           │                         │
     │                            │                         │
     │── pet:get-petdex-meta ───► │                         │
     │◄── PetMeta | null          │                         │
     │                            │                         │
```

### 3.8 设置页宠物选择器

```
  ┌─────────────────────────────────────┐
  │  当前宠物                          │
  │  选择桌面宠物外观...                │
  │  ┌─────────────────────────────┐   │
  │  │  wall-e-baby            ▼  │   │
  │  └─────────────────────────────┘   │
  │  ┌─ SelectContent ─────────────┐   │
  │  │  ┌─ SelectGroup ─────────┐  │   │
  │  │  │ 内置                  │  │   │
  │  │  │ ○ wall-e-baby        │  │   │
  │  │  │ ○ eve                │  │   │
  │  │  └──────────────────────┘  │   │
  │  │  ┌─ SelectGroup ─────────┐  │   │
  │  │  │ Petdex 市场           │  │   │
  │  │  │ ○ boba               │  │   │
  │  │  │ ○ lulu-capybara-2    │  │   │
  │  │  └──────────────────────┘  │   │
  │  └────────────────────────────┘   │
  └─────────────────────────────────────┘
```

---

## 4. 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| **修改** | `animation/types.ts` | 替换 PetState 为 9 标准状态，添加常量 |
| **删除** | `animation/manifest.ts` | 废弃，功能并入 types.ts + pet-loader.ts |
| **修改** | `animation/SpritePlayer.tsx` | durations[] 帧推进，标准常量尺寸，+ onerror |
| **新增** | `pet-loader.ts` | pet.json 加载 + grid 推导动画参数 + Petdex fallback |
| **新增** | `skins/wall-e-baby/pet.json` | Petdex 标准元数据 |
| **新增** | `skins/wall-e-baby/sprite.webp` | 1536×1872 WebP spritesheet |
| **新增** | `skins/eve/pet.json` | EVE 宠物元数据 |
| **新增** | `skins/eve/spritesheet.webp` | EVE spritesheet |
| **删除** | `skins/default/manifest.json` | 废弃 |
| **删除** | `skins/default/sprite.png` | 废弃 |
| **修改** | `PetWindow.tsx` | 运行时加载 + 状态映射 + 双击随机跑动 + 错误处理 |
| **修改** | `PetWindow.css` | 适配 192×208 帧 |
| **修改** | `electron/main/index.ts` | 注册 petdex:// 自定义协议 + protocol.handle |
| **修改** | `electron/main/ipc-handlers.ts` | + pet:list-petdex / pet:get-petdex-meta handlers |
| **修改** | `electron/main/settings-store.ts` | + selectedPetSlug 字段 |
| **修改** | `electron/preload/index.ts` | + listPetdexSkins / getPetdexMeta |
| **修改** | `electron/electron.d.ts` | + 新 IPC 方法类型声明 |
| **修改** | `settings-page.tsx` | 异步皮肤列表 + SelectGroup 分组 + 文案更新 |

---

## 5. 实施步骤（已完成）

### Phase 1：核心渲染改造

1. **类型定义** — 重写 `animation/types.ts`，添加 Petdex 常量和标准 ✅
2. **帧推进算法** — 重写 `animation/SpritePlayer.tsx`，支持 `durations[]` ✅
3. **Pet 加载器** — 新增 `pet-loader.ts` ✅
4. **验证** — 导入 wall-e-baby，确认 9 状态渲染正确 ✅

### Phase 2：PetWindow 接入

1. **状态映射** — 更新 PetWindow 状态映射逻辑 ✅
2. **气泡标签** — 更新中文文案 ✅
3. **尺寸适配** — CSS 微调，PET_DISPLAY_SCALE=0.72 ✅
4. **双击趣味** — 双击随机切换 running/running-left/running-right ✅

### Phase 3A：多宠物支持（内置）

1. **Electron IPC** — pet:get-selected / pet:select / pet-changed 事件 ✅
2. **设置页** — 宠物选择器 UI ✅
3. **自动发现** — import.meta.glob 编译时发现 ✅

### Phase 3B：Petdex 市场支持

1. **自定义协议** — petdex:// 注册 + protocol.handle ✅
2. **IPC handlers** — pet:list-petdex / pet:get-petdex-meta ✅
3. **Windows 兼容** — pathToFileURL + path.relative ✅
4. **选择器分组** — 内置 / Petdex 市场 分组显示 ✅

---

## 6. 设计决策

| 决策 | 说明 |
|------|------|
| Spritesheet 文件命名 | 支持 `sprite.webp` 和 `spritesheet.webp`，通过 `*/*.webp` glob 匹配 |
| spritesheetPath 兜底 | pet.json 无此字段时默认 `"sprite.webp"` |
| 路径穿越防护 | `path.relative(petsRoot, fullPath)` 检查，而非 `startsWith`（Windows 大小写安全） |
| 图片加载失败 | `img.onerror` 打 `console.warn`，canvas 保持空白 |
| 皮肤加载异常 | PetWindow 捕获并用 `console.error` 输出 |
| PetState 类型仅用于 type annotation | 运行时字符串字面量，模块常量 `RUNNING_STATES` 用 `as PetState[]` 注解 |

---

## 7. 成功指标

- [x] `manifest.json` / `SpriteSkinManifest` / `SpriteAnimation` 全部删除
- [x] 所有皮肤目录仅含 `pet.json` + `sprite.webp` / `spritesheet.webp`
- [x] wall-e-baby 9 种状态按正确帧序列播放
- [x] idle 循环 / waving 交互 / jumping 动画 / failed 状态 → 基本正确
- [x] 语音输入/输出/成功/错误 触发对应动画
- [x] 拖拽、气泡、提示等交互功能不变
- [x] 内置宠物只需 `pet.json` + 符合 9 行 grid 的 spritesheet 即可使用
- [x] Petdex 市集宠物直接下载到 `~/.codex/pets/` 即可加载
- [x] 内置 / Petdex 市场 分组显示
- [x] Windows / macOS / Linux 跨平台兼容
