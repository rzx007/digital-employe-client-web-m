# 会话上下文用量圆环 + 分类明细 — 设计稿

- 日期：2026-06-04
- 状态：待评审
- 范围：前端展示形态改造 + 后端 `/context-budget` 接口扩展

## 1. 背景与目标

当前 `ContextBudgetIndicator`（`apps/web/src/components/chat/panel/context-budget-indicator.tsx`）
已经能在会话级展示"上下文占用度"，数据来自后端 `/context-budget` 接口
（`apps/server/src/service/context_budget.py` 的 `resolve_context_budget_for_conversation`），
前端 `useContextBudget` hook 在 streaming 时每 4s 轮询、完成时 refetch。

不足：

1. 形态是**线性进度条**，希望改成 **圆环（ring）**，对齐 Cursor / Claude / opencode 的视觉。
2. 展开后没有**按来源类别的 token 明细**（System prompt / Tool definitions / Skills / Conversation）。

目标：圆环展示上下文占用度，悬浮/展开时显示 4 类来源的 token 分解。

**明确不在本次范围**（留作后续单独需求）：

- 流式过程中"实时 token 估算"替换文件 KB 标签。
- 会话级**累计计费**视角（所有轮次 input/output 求和）。本次只做**当前上下文占用度**（最后一轮 input）。
- MCP、Subagent 两类明细（详见下文可达性）。

## 2. 关键概念对齐

- **上下文占用度**：`最后一轮 input_tokens / 模型上下文窗口 max_input_tokens`。圆环表达的就是这个。
- **真实 vs 估算**：模型只回总的 `input_tokens`（真实，已落库到 `extra_meta.usage`）。
  按类别拆分只能用 tiktoken **本地估算**（且分词器为 cl100k_base，与实际 Qwen 分词存在系统性偏差），
  与真实总数不会精确相等。
- **诚实性设计**：
  - 圆环的总数/百分比用**真实** `last_input_tokens`。
  - 明细各类为**估算**，UI 一律标 `~`，并注明"估算"。
  - **不把无法归类的开销伪装成对话**：显式提供 **"其他/系统开销"** 一类
    = `max(0, last_input − 已测各类合计)`，吸收所有未单列项（deepagents BASE、各 middleware 注入段、
    思考 token、wire 协议开销、分词器偏差等），从而 5 类加总 == 圆环真实总数（见 §4.3）。

### 2.1 评审修正记录（重要）

初版假设 `真实 input ≈ build_system_prompt + 自定义工具 + 技能名字 + 对话历史`，
经评审核对 deepagents 源码后**该假设不成立**——真实发给模型的 system message 还包含：

- deepagents `BASE_AGENT_PROMPT`（约 600–800 token，`deepagents/graph.py`）。
- 各 middleware 追加的 system 段：FilesystemMiddleware（文件系统/执行提示）、TodoListMiddleware（write_todos 用法）、
  **MemoryMiddleware（`MEMORY_SYSTEM_PROMPT` 模板 + `/agent/AGENTS.md`、`/memories/AGENTS.md` 两份文件全文）**、
  **SkillsMiddleware（`SKILLS_SYSTEM_PROMPT` 模板 + 每个技能的"名字 + 完整描述 + 路径"，不是纯名字）**。
- deepagents **内置工具** schema：`write_todos / ls / read_file / write_file / edit_file / glob / grep / execute / task`，
  体量远大于本项目的少量自定义工具。

因此初版的"减法把这些全算进 Conversation"会严重误导。修正后的口径见 §3/§4。

## 3. 类别可达性结论（修正版）

为彻底规避"接口侧重建 prompt 必然漂移"，breakdown **在真正构建 agent / 运行该轮的位置计算**
（`stream_registry` / `get_agent`，所有真实输入都在手边），算完连同 usage 一起写入 `extra_meta.breakdown`。
接口侧只**读回**，不重建、不缓存。各类口径：

| 类别 | 计算口径（在 build 处算，详见 §4.1） | 归类边界 |
|---|---|---|
| System prompt | 项目侧 `build_system_prompt(...)` / 总管拼接全文 + memory 文件正文（strip HTML 注释） | **不含** BASE / filesystem-todo 动态段 → 归"其他" |
| Tool definitions | `extra_tools` + deepagents 内置工具（§4.1.1 口径）序列化合计 | 运行期工具增删偏差 → 归"其他" |
| Skills | 每条技能 `name+description+path`（读 SKILL.md frontmatter），对齐 SkillsMiddleware 注入格式 | skills 模板头 → 归"其他" |
| Conversation | 复用 `usage_estimation._collect_conversation_texts()` + `estimate_text_tokens()` 直接估算历史 | — |
| 其他/系统开销 | `max(0, last_input − 上述四类合计)` | 吸收所有未单列项（BASE/中间件动态段/profile/wire/分词偏差/Subagent/MCP），保证加总 == 真实总数 |
| Subagent definitions | 恒 0（两 agent 均 `subagents=[]`） | 并入"其他"，不单列 |
| MCP | 不适用（不直接注入主 agent 输入） | 并入"其他"，不单列 |

## 4. 后端设计

### 4.1 计算位置：build/run 处，写入 extra_meta（不在接口重建）

在构建 agent 的位置（员工 `get_agent` / 总管 `get_orchestrator_agent`）计算——那里已具备全部真实输入
（`root_path`、`skill_path`、`enable_hitl`、`include_sqlite_tools`、`extra_tools`、memory 文件路径与当时磁盘内容、技能目录）。

#### 计量口径（每项只归一类，杜绝重复计数）

新增纯计算函数 `compute_context_breakdown_components(...) -> dict[str,int]`，只产出我们能**可靠**量化的三项；
凡是无法稳定量化的（deepagents `BASE_AGENT_PROMPT`、profile 替换/后缀、FilesystemMiddleware/TodoListMiddleware
运行期动态生成的 system 段、wire 协议开销、cl100k 与 Qwen 分词偏差）**一律不计入这三项**，由接口侧"其他/系统开销"兜底：

- **system_prompt** = tokens(`build_system_prompt(...)` 项目侧全文 / 总管拼接全文)
  + Σ tokens(memory 文件正文，读当时磁盘并先 `_strip_html_comments`)。
  **不含** deepagents BASE、不含 filesystem/todo 动态段（→ 归"其他"）。
- **tool_definitions**：见下 §4.1.1 的工具全集口径，Σ tokens(`f"{name}\n{description}\n{json.dumps(args_schema)}"`)。
- **skills** = Σ tokens(每条技能 `"- **{name}**: {description}\n  Read \`{path}\`"`，读 `SKILL.md` frontmatter 的 name/description)。
  对齐 SkillsMiddleware 真实注入格式。skills 模板头（`SKILLS_SYSTEM_PROMPT`）属固定开销 → 归"其他"，**不计入此项**。

各项用 `estimate_text_tokens()` 计数。

#### 4.1.1 工具全集口径（解决"内置工具不可从编译图枚举"）

deepagents 内置工具（`write_todos / ls / read_file / write_file / edit_file / glob / grep / execute / task`）
由 `create_deep_agent` 内部的 middleware 注入，编译后**无法从返回的 `CompiledStateGraph` 平铺枚举**，
且 `execute` 等会被运行期按 backend/profile 增删。因此 tool_definitions 采用：

- `extra_tools`（本项目自定义工具，`get_agent` 内已持有）逐个序列化计数；**加上**
- deepagents 内置工具：在 `get_agent` 内**显式实例化**与 `create_deep_agent` 同款的 middleware
  （`FilesystemMiddleware(...)`、`TodoListMiddleware()` 等，用同一组参数）并读取其 `.tools` 序列化计数，
  **或**维护一份内置工具名单常量做近似。
- 运行期工具增删（`execute` 过滤、`_ToolExclusionMiddleware`）造成的小幅偏差 → 由"其他"兜底。

> 实现红线：**禁止**为了取工具而调用 `create_deep_agent`/`get_agent` 自身（递归 + 副作用）；
> 只实例化轻量 middleware 读 `.tools`，或用常量名单。

#### 4.1.2 组件数据如何从 build 期送达落库期（解决 S-A）

build 期算出的 `breakdown_components` 与流结束时落库的 usage **不在同一作用域**
（usage 在子线程从 buffer 抽取，`_flush_terminal_sync` 局部只有 `stream_msg_id/buffer/content/conversation_id`）。
传递机制：**模块级注册表按 `conversation_id` 暂存**，避免穿透 5~6 层调用栈改签名：

```python
# 新建 context_breakdown.py
_PENDING_COMPONENTS: dict[int, dict[str, int]] = {}
def stash_breakdown_components(conversation_id: int, comps: dict[str, int]) -> None: ...
def pop_breakdown_components(conversation_id: int) -> dict[str, int] | None: ...
```

- `get_agent` / `get_orchestrator_agent` 在拿到 `conversation_id` 后算好组件并 `stash_(...)`（覆盖语义：同一会话新轮覆盖旧值）。
- `_flush_terminal_sync` 写 usage 处 `pop_(conversation_id)`，与 usage 一并写入该轮 assistant 消息的 `extra_meta`。
- dict 读写受 GIL 保护，无需额外锁；`pop` 即清理，避免泄漏；进程内一会话同时仅一条活跃流，覆盖语义安全。
- 若 `pop` 为 `None`（异常/旧流程）→ 不写 `breakdown_components`，接口侧按"历史会话无组件"降级（见 §4.2）。

落库结构：

```jsonc
"extra_meta": {
  "usage": { "input_tokens": 52900, "output_tokens": 1200, ... },
  "breakdown_components": { "system_prompt": 4200, "tool_definitions": 3100, "skills": 900 }
}
```

> 取舍：组件每轮重算（几次 tiktoken 编码，开销极小），不缓存；memory 被 `remember_memory` 跨轮改，每轮算正好反映当时状态。

### 4.2 接口：只读回 + 兜平

扩展 `GET /chat/conversations/{conversation_id}/context-budget`，
`resolve_context_budget_for_conversation` 在选出"最后一条带 usage 的 assistant 消息"时，
同时取该消息的 `breakdown_components`，并直接估算对话历史：

```python
class ContextBudgetBreakdown(BaseModel):
    system_prompt: int
    tool_definitions: int
    skills: int
    conversation: int
    other: int          # max(0, last_input - 上述四类合计)；吸收未单列开销
    total: int          # == last_input_tokens（圆环真实总数）
    estimated: bool = True

class ContextBudgetRead(BaseModel):
    # ... 现有字段不变 ...
    breakdown: ContextBudgetBreakdown | None = None
```

计算：

```
conversation = estimate_text_tokens("\n".join(_collect_conversation_texts(db, conversation_id)))
measured = system_prompt + tool_definitions + skills + conversation
other    = max(0, last_input - measured)
# 若 measured > last_input（估算偏大）：按比例把五类压缩到 last_input，保证 Σ == last_input
```

边界：

- `last_input_tokens is None`（首轮未完成）：`breakdown = None`，前端显示占位。
- 旧消息 `extra_meta` 无 `breakdown_components`（本特性上线前的历史会话）：
  system/tools/skills 记为 `0`，全部计入 `other`，UI 正常显示（明细偏粗但总数仍准）。

### 4.3 agent 类型判定

会话 `target_type` 取值：`curator` → 总管；`employee`（或员工类）→ 员工（`target_id` 为 employee_id）；
`group` 等其它分支在 `chat_service` 中本就会拒绝起流（参考 `chat_service.py` 对 `target_type` 的校验），
故只有总管/员工两条路径会产生组件。两条路径在各自 build 处分别采集，互不影响。

### 4.4 tiktoken

复用 `apps/server/src/service/usage_estimation.py` 的 `estimate_text_tokens()`（cl100k_base，已具备 fallback）。
注：分词器与实际 Qwen 不同，明细为粗估，故全程标 `~`；圆环总数用真实 usage 不受影响。

## 5. 前端设计

### 5.1 圆环组件

- 新增 `ContextRing`（SVG 双层 circle：底色轨道 + 进度弧），尺寸约 16–20px，
  放在原 `ContextBudgetIndicator` 触发按钮内，替换原先的 `xx%` 文本主视觉（百分比可保留在环心或环旁）。
- 进度弧颜色复用 `zoneColorClass(zone)`（ok / 接近摘要 / 已达摘要线）。
- 阈值标记（50% 截断 / 75% 摘要）原本在线性条上，移入 HoverCard 文案说明，或在环上以刻度点表示（v1 先放文案）。

### 5.2 展开明细

HoverCard 内容区在现有"输入 X / max"上方或下方增加分类明细：

```
System prompt      ~4.2K
Tool definitions   ~3.1K
Skills             ~0.9K
Conversation       ~44.4K
其他/系统开销       ~0.3K
─────────────────────────
合计                52.9K / 200K   （= 真实 last_input，不带 ~）
```

- 数字格式复用 `formatTokenCount()`。
- 五类（估算项）前缀 `~`；"合计"用真实 `total`，**不**带 `~`。
- `breakdown == null` 时显示："首轮回复完成后显示明细"。
- "其他/系统开销"恒显示（哪怕为 0 也显示，以解释总数与可见类别的差额）。
- 可选：每类配一个小色块，呼应 Cursor 的分段条（v1 可省，纯列表即可）。

### 5.3 类型与 hook

- `ContextBudgetSnapshot`（`apps/web/src/lib/chat/context-budget.ts`）增加可选 `breakdown` 字段，
  与后端 `ContextBudgetBreakdown` 对应（含 `other`、`total`）。
- `useContextBudget` 的乐观合并逻辑（从消息 metadata 读 usage）保持不变；
  `breakdown` 仅来自接口轮询结果（乐观态下 `breakdown` 取 `query.data?.breakdown`）。
- **过渡态可接受**：乐观快照（仅有 usage、无 breakdown）下，圆环已有百分比但展开显示占位文案，
  待下一次 4s 轮询拿到接口 `breakdown` 后补全。文档明确认可此短暂不一致。

## 6. 边界与降级

- tiktoken 不可用 → `estimate_text_tokens` 已有 `len/2` fallback，明细仍可出（标估算）。
- 历史会话（上线前的消息无 `breakdown_components`）→ system/tools/skills 记 0、全计入"其他"，总数仍准。
- 总管/员工以外的 `target_type` → 不采集组件；接口侧 system/tools/skills 缺失按 0 处理，全计入"其他"。
- 接口对 `breakdown` 全程**可选**，老前端忽略该字段不受影响。
- 计算函数**禁止**触发真实 `create_deep_agent`（避免 checkpointer / SQL toolkit 等副作用）；
  组件采集在已有的 build 流程内顺带完成，不额外建 agent。

## 7. 测试

后端（pytest，参考 `apps/server/tests/test_context_budget.py`）：

- 组件计算：给定固定 system_text/tools/skill_entries，`compute_context_breakdown_components` 输出稳定且 > 0。
- 接口兜平：`system_prompt + tool_definitions + skills + conversation + other == total == last_input_tokens`。
- `measured > last_input` 时按比例压缩，Σ 仍等于 last_input。
- 旧消息无 `breakdown_components` → system/tools/skills=0、`other` 吸收差额，`total == last_input`。
- `last_input is None` → `breakdown is None`。

前端：

- `breakdown` 存在时五类渲染、合计 == 真实 `total`。
- `breakdown == null` 时占位文案。
- 圆环百分比 == `usedPercent`。

## 8. 影响文件

后端：
- 新建 `apps/server/src/service/context_breakdown.py`：`compute_context_breakdown_components(...)` 纯计算函数 +
  `stash_breakdown_components` / `pop_breakdown_components`（模块级注册表，§4.1.2）+ 内置工具序列化口径（§4.1.1）。
- `apps/server/src/service/agent/employee.py`、`apps/server/src/service/agent/orchestrator/agent.py`：
  build 处算组件并 `stash_(conversation_id, comps)`。
- `apps/server/src/service/stream_registry.py`：`_flush_terminal_sync` 写 usage 处 `pop_(...)`，一并写入 `extra_meta`。
- `apps/server/src/service/context_budget.py`：`ContextBudgetBreakdown` 模型 + 读回 `breakdown_components` + 对话历史估算 + 兜平。
- `apps/server/src/service/usage_estimation.py`：复用/暴露 `estimate_text_tokens`、`_collect_conversation_texts`（预计仅暴露，不改逻辑）。

前端：
- `apps/web/src/components/chat/panel/context-budget-indicator.tsx`（圆环 + 五类明细）。
- 新增 `ContextRing` 组件。
- `apps/web/src/lib/chat/context-budget.ts`（`ContextBudgetSnapshot` 增加 `breakdown` 字段）。
