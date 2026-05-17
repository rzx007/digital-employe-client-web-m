# 桌面宠物 Petdex/Codex 标准化改造 PRD

> 版本：v1.0 | 日期：2026-05-17

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

## 2. 目标架构

### 2.1 核心变化

```
┌────────────────── 当前 ──────────────────┐
│                                          │
│  manifest.json (自定)                     │
│  sprite.png (2048×1536 8×6)              │
│       ↓                                  │
│  manifest.ts → SpriteAnimation (fps)     │
│       ↓                                  │
│  SpritePlayer (canvas, 统一 fps)          │
│       ↓                                  │
│  PetWindow (静态 import default)          │
│                                          │
└──────────────────────────────────────────┘

┌────────────────── 目标 ──────────────────┐
│                                          │
│  pet.json (id/displayName/description)    │
│  sprite.webp (1536×1872 8列×9行)         │
│       ↓                                  │
│  pet-loader.ts → 按 grid 约定推导动画参数  │
│       ↓                                  │
│  SpritePlayer (canvas, per-frame duration)│
│       ↓                                  │
│  PetWindow (运行时加载选中皮肤)            │
│  ← Electron IPC: pet:list / pet:select   │
│                                          │
└──────────────────────────────────────────┘
```

### 2.2 删除的组件

- `manifest.json` 自定格式 — `pet.json` 替代
- `SprintSkinManifest.type` — 不再需要（只有 sprite 一种类型）
- `SprintAnimation.fps` — `durations[]` 替代
- `SprintSkinManifest.frameWidth/frameHeight/columns` — 从 grid 约定推导
- `SprintSkinManifest.scale/autoAlign/defaultAnimation` — 统一处理
- 静态 `import` 皮肤 — 运行时动态加载
- PNG spritesheet — WebP 替代

### 2.3 保留的组件

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

### 3.3 Pet 加载器 (`pet-loader.ts`，新增)

```typescript
export type PetMeta = {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
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
  image: string     // resolved image URL/path
  animations: Record<PetState, PetFrameAnimation>
}

export function parsePetSkin(meta: PetMeta, imageSrc: string): PetSkin {
  return {
    meta,
    image: imageSrc,
    animations: Object.fromEntries(
      PET_STATES.map((state, row) => {
        const frameCount = PET_FRAMES_PER_ROW[state]
        const from = row * PET_SHEET_COLS
        return [
          state,
          {
            row,
            from,
            to: from + frameCount - 1,
            durations: PET_DURATIONS[state],
            loop: state !== "jumping", // jumping 做完一遍可停
          } satisfies PetFrameAnimation,
        ]
      })
    ) as Record<PetState, PetFrameAnimation>,
  }
}
```

支持后续扩展：自定义宠物可重写 `PET_DURATIONS` `PET_FRAMES_PER_ROW`（在 `pet.json` 中可选指定）。

### 3.4 SpritePlayer 改造 (`animation/SpritePlayer.tsx`)

帧推进算法改为 `durations[]` 驱动：

```typescript
// 伪代码
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

`drawFrame` 使用 `PET_SHEET_FRAME_W/H` 和 `PET_SHEET_COLS` 计算 source 坐标：

```typescript
function drawFrame(frameIndex: number) {
  const sourceX = (frameIndex % PET_SHEET_COLS) * PET_SHEET_FRAME_W
  const sourceY = Math.floor(frameIndex / PET_SHEET_COLS) * PET_SHEET_FRAME_H
  // ...drawImage with these dimensions
}
```

### 3.5 PetWindow 状态映射

| 应用事件 | 触发时机 | Petdex 状态 |
|---------|---------|-------------|
| 默认无操作 | — | `idle` |
| 录音中 | `isRecording === true` | `waving` |
| 语音处理中 | `voiceBusy === true` | `waiting` |
| 成功反馈 | `feedback.variant === "success"` | `jumping` → 播放完切回 `idle` |
| 错误反馈 | `feedback.variant === "error"` | `failed` |
| 信息提示 | `feedback.variant === "info"` | `waving` |

```typescript
const petState: PetState = useMemo(() => {
  if (feedback.variant === "error") return "failed"
  if (voiceBusy) return "waiting"
  if (isRecording) return "waving"
  if (feedback.variant === "success") return "jumping"
  if (feedback.variant === "info") return "waving"
  return "idle"
}, [feedback.variant, voiceBusy, isRecording])
```

### 3.6 Electron IPC — 宠物选择（Phase 2）

```typescript
// preload 新增
getInstalledPets: () => ipcRenderer.invoke("pet:list-installed"),
selectPet: (slug: string) => ipcRenderer.invoke("pet:select", slug),
getSelectedPet: () => ipcRenderer.invoke("pet:get-selected"),

// main 新增
ipcMain.handle("pet:list-installed", async () => {
  // 扫描 ~/.codex/pets/*/pet.json
  // 返回 { slug, displayName }[]
})

ipcMain.handle("pet:select", async (_event, slug: string) => {
  setSetting("selectedPet", slug)
  // 通知 pet window 刷新
})

ipcMain.handle("pet:get-selected", () => {
  return getSetting("selectedPet") ?? "default"
})
```

---

## 4. 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| **修改** | `animation/types.ts` | 替换 PetState 枚举为 9 标准状态，添加常量 |
| **修改** | `animation/manifest.ts` | 删除，功能合并入 types.ts + pet-loader.ts |
| **修改** | `animation/SpritePlayer.tsx` | 帧推进改 durations 数组，尺寸用标准常量 |
| **新增** | `pet-loader.ts` | 读取 pet.json + 按 grid 约定推导动画参数 |
| **新增** | `skins/wall-e-baby/pet.json` | Petdex 标准元数据 |
| **新增** | `skins/wall-e-baby/sprite.webp` | 1536×1872 WebP spritesheet |
| **删除** | `skins/default/manifest.json` | 废弃 |
| **删除** | `skins/default/sprite.png` | 废弃 |
| **修改** | `PetWindow.tsx` | 静态 import → 运行时加载；状态映射 |
| **修改** | `PetWindow.css` | 适配 192×208 帧 (PET_DISPLAY_SCALE 微调) |
| **修改** | `electron/preload/index.ts` | 新增 pet listing/selection IPC |
| **修改** | `electron/main/ipc-handlers.ts` | 新增 IPC handlers |
| **可选新增** | `electron/main/pet-store.ts` | 宠物管理逻辑 |

---

## 5. 实施步骤

### Phase 1：核心渲染改造

1. **类型定义** — 重写 `animation/types.ts`，添加 Petdex 常量和标准
2. **帧推进算法** — 重写 `animation/SpritePlayer.tsx`，支持 `durations[]`
3. **Pet 加载器** — 新增 `pet-loader.ts`
4. **验证** — 导入 wall-e-baby 的 `pet.json` + `sprite.webp`，确认渲染正确

### Phase 2：PetWindow 接入

1. **状态映射** — 更新 `PetWindow.tsx` 状态映射逻辑
2. **气泡标签** — 更新 `petStateLabels` 中文文案
3. **尺寸适配** — CSS 微调，`PET_DISPLAY_SCALE` 适配 192×208
4. **验证** — 完整交互流程（录音、识别、成功/错误反馈）确认动画正确

### Phase 3：多宠物支持（可选）

1. **Electron IPC** — 新增 `pet:list-installed` / `pet:select` / `pet:get-selected`
2. **设置页** — 宠物选择器 UI
3. **验证** — 安装多个 Petdex 宠物，切换确认

---

## 6. 成功指标

- [ ] `manifest.json` / `SpriteSkinManifest` / `SpriteAnimation` 全部删除
- [ ] 所有皮肤目录仅含 `pet.json` + `sprite.webp`
- [ ] wall-e-baby 9 种状态按正确帧序列播放
- [ ] idle 循环 / waving 交互 / jumping 一次播放 / failed 闪烁 → 正确
- [ ] 语音输入/输出/成功/错误 触发对应动画
- [ ] 拖拽、气泡、提示等交互功能不变
- [ ] 自定义宠物只需 `pet.json` + 符合 9 行 grid 的 spritesheet 即可使用
- [ ] Petdex 市集宠物直接下载到 `~/.codex/pets/` 即可加载
