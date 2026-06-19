# 总管直接操控工作台：对话即编排 + 规格化网格

日期：2026-06-19
状态：设计已确认，待写实现计划

## 背景与动机

2026-06-16 的重构（`2026-06-16-workbench-html-panel-refactor-design.md`）已把工作台看板的内容来源改为「总管对话生成的 HTML 产物」。但留下一个痛点：产物生成后，**唯一上台方式是用户去资源面板右键「📌 钉到工作台」，再手动拖拽缩放**。

用户的判断：

> 总管助手做好的 HTML 要手动去钉在工作台才能使用，体验太差。理论上应该有一套 tools/skills 支撑模型对工作台的操作——「我就是要做一个看板」，钉、放大缩小、调样式这些应该由模型根据对话完成，而不是人手动去那里订。

参考飞书工作台：规格化网格、卡片标准尺寸、自动吸附对齐。

本设计让**总管在工作台页面内，通过对话直接操控看板**（钉/改尺寸/移位/改标题/隐藏/删除/重排），并把布局模型从「任意像素」升级为「规格化网格」。

## 范围（已与用户逐条确认）

- **本期（B 档）**：自动钉 + 总管全量编排工作台。当前会话任意 `.html` 产物（含来回改的历史版本）。规格化网格作为布局基础。
- **二期（不在本设计内）**：跨会话的**全局资源库 / 素材库**——所有历史产物沉淀进统一仓库、随时取用、重新钉。用户确认要做，但本期不做，避免在「产物去哪」上返工前先把对话编排打通。

### 交互边界（已确认）

总管操控工作台**只发生在工作台页面内**（`WorkbenchContentSplit` 里右侧的 `CuratorView`）。用户对右侧总管对话框说话 → 操控左侧网格看板。**不做**跨界面远程指挥（如在员工聊天里指挥工作台），因为那需要跨界面状态同步，复杂度高且非诉求。

这个边界让架构自洽：同一界面内总管对话的 SSE 流是活的，前端 handler 当场收得到指令并执行。

## 非目标（YAGNI）

- 不做跨会话全局资源库（二期）。
- 不做跨界面远程指挥工作台。
- 不改 artifact 渲染管道（`HtmlArtifactRenderer` 沙箱 iframe 不动）。
- 不改总管对话本身的会话/流式机制。
- 不改工作台左栏（日程/今日任务/绩效）。
- 不做旧像素 config 到新网格的数据迁移（检测到即重置）。

## 核心架构

### 数据流（顺现有「服务端工具回吐指令、前端 handler 执行」模式）

```
① 用户在工作台右侧总管框说「做个销售看板，放大点放左上」
        │
        ▼
② 总管生成 sales.html → 落到当前会话 /artifacts/（已有管道）
        │
        ▼
③ 总管调工具 arrange_workbench(operations)
   工具只校验 + 回吐归一化 JSON 指令，不直接改数据
   （服务端碰不到浏览器 localStorage，故只能回吐）
        │
        ▼
④ SSE 流推给前端 → tool-handler 按 toolName 匹配
        │
        ▼
⑤ 新 handler workbench-arrange 把指令事务性应用到工作台 config
   pin / resize / move / rename / hide / remove / reorder
        │
        ▼
⑥ emitWorkbenchConfigChanged() → 规格化网格当场重渲染，看板吸附就位
```

这套模式仓库已在用（`plan-generated`、`group-created` 等 handler），非另起炉灶。

### 为何是「回吐指令」而非「工具直接改」

工作台 config 存在**浏览器 localStorage**（`workbench-config-global`），总管工具跑在 **Python 服务端**，服务端无法触达浏览器存储。唯一可行路径是工具回吐结构化指令、前端 handler 执行真正的本地操作。

## 布局模型：规格化网格

把现有「任意像素 `width?/height?`」替换为规格化网格（飞书风格）。

- 网格固定 **12 列**（随容器宽度响应），行高固定（实现时定，约 120px/行）。
- 看板的 `gridSpan: { w, h }`——占的**列数/行数**（非像素）。标准档位（数值实现时微调）：
  - 小 `3×2`、中 `6×3`、大 `6×6`、满宽 `12×6`
- 看板的 `gridPos: { x, y }`——左上角落在第几列、第几行。
- 总管语义映射：「放大」=升一档 span；「放左上」=`pos {0,0}`；「这俩并排」=相邻 x、相同 y、各占一半列宽。
- 手动拖拽/缩放保留，但**吸附到网格**（不再像素级）。

### 技术选型

引入 **`react-grid-layout`** 替换手写的 `DraggableWorkbenchGrid` 拖拽逻辑——它正是飞书那种网格，自带拖拽吸附与碰撞处理。总管给的 `{x,y,w,h}` 直接喂给它，省去自写碰撞算法。我们只维护「档位 → span 数值」的映射层。

### 数据模型变更

```ts
// types/workbench.ts

type GridSpanPreset = "small" | "medium" | "large" | "full"

interface GridSpan { w: number; h: number }   // 列数 / 行数
interface GridPos  { x: number; y: number }    // 起始列 / 起始行

interface WorkbenchBlock {
  id: string
  type: "html-artifact"
  title: string
  enabled: boolean              // hide 用 enabled=false
  order: number
  htmlRef: HtmlArtifactRef
  gridSpan: GridSpan            // 取代 width?
  gridPos: GridPos             // 取代（自由摆放）
  // 删除：width?, height?（像素）
}
```

旧 config 检测：加载时若任一 block 缺 `gridSpan`（或仍带像素 `width/height`）→ 整体重置为空 + `console.warn`，沿用现有 `isValidConfig` 重置机制，不迁移。

## 总管工具（服务端）

新增 `apps/server/src/service/agent/orchestrator/tools/workbench.py`，注册进总管工具集（`tools/__init__.py` re-export + agent 工具清单）。

**单一工具 + 批量 operations**（而非拆 pin/resize/move 多个），因为用户诉求常是复合的（钉+放大+移位一次说完），单工具一次回吐一批、前端事务应用，避免半截状态；也与 `create_orchestration_plan` 一次吐整个计划的现有风格一致。

```python
@tool
def arrange_workbench(operations: str) -> str:
    """编排工作台看板。operations 是 JSON 指令数组（字符串）。
    每条指令 op ∈ {pin, resize, move, rename, hide, remove, reorder}：
      - pin:     {op, resourcePath, title?, span?, pos?}  钉当前会话某 .html
      - resize:  {op, blockRef, span}                     span ∈ small/medium/large/full
      - move:    {op, blockRef, pos:{x,y}}
      - rename:  {op, blockRef, title}
      - hide:    {op, blockRef}
      - remove:  {op, blockRef}
      - reorder: {op, order:[blockRef, ...]}
    blockRef = 看板标题或序号（总管不知道前端 blockId，由前端 handler 解析）。
    """
```

工具内部（**只校验 + 归一化，不改数据**）：

1. 解析 `operations` JSON；非法 JSON / 未知 op → 返回错误文本，让总管自纠。
2. 对 `pin`：校验 `resourcePath` 在**当前会话** `/artifacts/` 下真实存在且为 `.html`（用现有会话资源读取能力）；不存在 → 返回错误文本，不发指令。
3. `span` 档位归一化为 `{w,h}`（small/medium/large/full → 具体数值），`pos` 透传。
4. 校验通过 → 回吐带 marker 的结构化结果（归一化后的 operations 数组），供前端 handler 执行。

### 总管如何感知工作台现状（已确认方案）

总管要说「把销售看板放大」就得知道台上有哪些看板、叫什么。**真相（工作台 config）在前端，总管在服务端**。

方案：**前端在工作台总管面板里，把当前看板清单（标题/span/pos）作为一条隐藏的 system-context 注入总管对话**，不占用户可见气泡；看板变化（`workbench-config-changed`）时刷新注入。

注入点只在 `WorkbenchContentSplit` 的 `CuratorView`——总管对话本就只在工作台面板发生（边界 A），故注入天然存在、且只在工作台场景，不污染别处。

**否决的两个备选**：
- *快照随每轮请求带给服务端*——需新增前端→服务端请求字段，每轮都传（哪怕不聊工作台），污染请求结构。
- *给总管一个 `list_workbench` 读工具*——同样面临服务端读不到浏览器存储，且需工具"等前端应答"，比单向注入复杂。

## 前端执行通道

### 新增 handler

`apps/web/src/lib/chat/tools/handlers/workbench-arrange.ts`，挂进现有 handler 注册表（与 `plan-generated` 同款 `ToolBlockHandler`）：

- `match`: `vm.toolName === "arrange_workbench"`
- 从回吐结果取归一化 operations 数组，**事务性**应用：先在内存里基于当前 config 算出新 config，全部校验通过后**一次性** `saveWorkbenchConfig` + `emitWorkbenchConfigChanged`。一条坏的不污染其余、不出现半截状态。
- op → config 操作映射：
  - `pin` → `addHtmlArtifactBlock(...)`（扩展为接受 `span`/`pos`，缺省给默认档位与自动找空位）
  - `resize` → `setBlockSpan(blockId, span)`
  - `move` → `setBlockPos(blockId, pos)`
  - `rename` → 改 `title`
  - `hide` → `enabled=false`
  - `remove` → `removeBlock`
  - `reorder` → `updateBlockOrder`
- **`blockRef` 解析**：handler 拿到「标题/序号」→ 在当前 config 里查 blockId。查不到（总管记错名）→ **跳过该条** + 看板上轻提示「未找到名为 X 的看板」，不整批崩。

### config 层扩展（`lib/workbench/workbench-config.ts`）

- `addHtmlArtifactBlock` 增加可选 `span`/`pos` 入参（默认档位 + 自动寻空位）。
- 新增 `setBlockSpan(config, blockId, span)`、`setBlockPos(config, blockId, pos)`。
- 删除像素 `updateBlockSize` 的像素语义，改为网格语义。
- `isValidConfig`：要求每 block 含合法 `gridSpan`/`gridPos`；旧像素结构判定为非法 → 重置。

### 隐藏上下文注入

在 `WorkbenchContentSplit`（或其 `CuratorView` 封装）监听 `workbench-config-changed`，将当前看板清单（标题 + span + pos）作为隐藏 system-context 注入总管对话。仅工作台面板生效。

### 保留手动钉

资源面板（`artifact-panel.tsx`）右键「钉到工作台」**保留**——作为兜底与"不想跟总管说话时"的入口。它走同一个 `addHtmlArtifactBlock`，钉上来时给默认 `span`/`pos`，自然兼容新网格。

## 网格渲染组件

`draggable-workbench-grid.tsx` 改造（或新组件替换）：

- 用 `react-grid-layout` 承载，把每个 `WorkbenchBlock` 映射成 `{ i: id, x, y, w, h }`。
- 拖拽/缩放回调 → 写回 `gridPos`/`gridSpan`（吸附后的网格值），持久化。
- 每格内容仍是现有 `WorkbenchHtmlPanel`（不动）。
- 空状态文案：引导「去右侧问总管做一个看板」。

## 错误处理

- **产物不存在**：`arrange_workbench` 服务端校验失败 → 返回错误文本，总管自纠，不发指令到前端。
- **blockRef 解析失败**：handler 跳过该条、其余照常应用，看板轻提示「未找到名为 X 的看板」，不整批崩。
- **operations JSON 非法 / op 未知**：服务端工具层先挡（返回错误文本）；前端 handler 再防御性跳过坏条目，应用好的。
- **源 HTML 后被删/404**：沿用现有 `WorkbenchHtmlPanel` 占位（「产物已不存在，可移除」），不崩。
- **旧像素 config**：加载检测到缺 `gridSpan` → 整体重置为空 + `console.warn`，不迁移。

## 测试

- 服务端 `tests/test_workbench_tool.py`：`arrange_workbench` 的 operations 解析、路径校验（存在 / 不存在 / 非 .html）、非法 JSON、未知 op、span 档位归一化、回吐结构。
- 前端 `workbench-arrange.test.ts`：各类 op 正确转成 config 变更；blockRef 找不到时跳过不崩；事务性（一条坏的不污染其余）。
- 前端 `workbench-config.test.ts` 扩展：`gridSpan`/`gridPos` 的 add/resize/move/reorder；旧像素 config 检测重置；`addHtmlArtifactBlock` 默认档位 + 自动寻空位。
- 网格映射层单测：span 档位 → `{w,h}` 与渲染列宽/行高映射（测我们的映射层，非 react-grid-layout 本身）。

## 文件清单

### 新增

- `apps/server/src/service/agent/orchestrator/tools/workbench.py` — `arrange_workbench` 工具。
- `apps/server/tests/test_workbench_tool.py`
- `apps/web/src/lib/chat/tools/handlers/workbench-arrange.ts` — 前端执行 handler。
- `apps/web/src/lib/chat/tools/handlers/workbench-arrange.test.ts`

### 改造

- `apps/server/src/service/agent/orchestrator/tools/__init__.py` — re-export `arrange_workbench`。
- 总管 agent 工具清单（注册 `arrange_workbench`）。
- `apps/web/src/types/workbench.ts` — `WorkbenchBlock` 删像素字段、加 `gridSpan`/`gridPos`；新增 `GridSpan`/`GridPos`/`GridSpanPreset`。
- `apps/web/src/lib/workbench/workbench-config.ts` — `addHtmlArtifactBlock` 支持 span/pos；新增 `setBlockSpan`/`setBlockPos`；`isValidConfig` 校验网格字段；旧像素重置。
- `apps/web/src/components/workbench/draggable-workbench-grid.tsx` — 改用 `react-grid-layout`，映射 `{x,y,w,h}`，吸附持久化。
- `apps/web/src/components/workbench/workbench-content-split.tsx`（或 CuratorView 封装）— 监听 `workbench-config-changed`，注入看板清单隐藏上下文。
- handler 注册表 — 挂入 `workbench-arrange`。

### 保留不动

- `HtmlArtifactRenderer` 及 artifact 渲染管道。
- `WorkbenchHtmlPanel`（含源文件缺失占位）。
- 资源面板右键「钉到工作台」（兜底入口，走同一 `addHtmlArtifactBlock`）。
- 工作台左栏（日程/今日任务/绩效）。
- 总管对话会话/流式机制。

## 依赖

- 新增 npm 依赖 `react-grid-layout`（含其 CSS）。

## 开放问题

- `span` 四档具体列/行数与行高像素值——实现时按 12 列网格与现有容器高度调，先用 `小3×2/中6×3/大6×6/满宽12×6`。
- `reorder` 与 `react-grid-layout` 的自由摆放是否冲突——若库按 `{x,y}` 自由定位，`order` 字段可能退化为仅渲染兜底序；实现时确认是否仍需 `order`。
- 隐藏上下文注入的具体载体（system message vs 请求附加字段）——实现时对齐总管会话现有的上下文注入方式，复用而非新造。
- 总管多轮内对同一看板连续操作时 blockRef 用标题是否够稳（标题可能刚被 rename）——必要时让回吐结果带回前端分配的 blockId，后续轮用 id 引用。
