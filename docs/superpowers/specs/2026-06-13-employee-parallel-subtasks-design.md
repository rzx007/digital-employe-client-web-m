# 单员工内部并行子任务（in-conversation parallel subtasks）— 设计

> 日期：2026-06-13
> 范围：`apps/server` 员工 agent（`get_agent`），让单个员工在自己的执行会话内
> 把一个活拆成多个**相互独立**的子任务并行跑，主流程不必逐个串行等待。
> **不**涉及编排层（OrchestrationPlan/DAG）、**不**涉及跨进程后台长任务（远程 Agent Protocol）。

## 0. 实现状态（2026-06-13 已落地并端到端验证）

**已完成**：
- 单元 B'：`checkpointer.py` 安全 profile 改 `general_purpose_subagent enabled=True`，
  重开 task；`excluded_tools={"execute"}` 不变，子代理同样继承（实测 + 回归测试坐实
  task 重开且 execute 仍排除 → 子代理只能走受管 shell_execute）。
- 单元 B：`subagent_concurrency.py` 新增 `SubagentConcurrencyMiddleware`（per 父会话
  `asyncio.Semaphore`），经 `HarnessProfile.extra_middleware` 工厂注入；上限
  `settings.subagent_max_parallel`（默认 3，KV `SUBAGENT_MAX_PARALLEL` 可覆盖）。
- 单元 C：`prompts.py` task 并行指南（早前已做，重开后才生效）。
- 测试：`tests/test_subagent_parallel.py` 10 项全过（设置默认/解析、profile 安全边界、
  信号量限流、跨会话隔离）。

**端到端实测**（员工 58，三芯片调研活）：重开前两轮 task=0（串行）；**重开后模型
真的 fan-out**，3 个子任务并行跑、各自用 shell 取数并把分析写入**共享** conv-644
artifacts（ascend910b.md/h100.md 等），子任务结果以 ToolMessage 回父 agent。
信号量日志确认 `concurrency limit = 3` 生效。

**单元 A（显式 SubAgent spec）——未做，有意省略**：profile 自动注入的 general-purpose
已继承正确工具集 + execute 排除 + 信号量中间件，安全目标已达成；再写显式 spec 会重复
重建整套 middleware 栈、徒增风险。YAGNI。

**已知遗留（本 spec 之外，单独跟进）**：
1. **父 agent 在子任务全部返回后未立刻产出最终综合、流尾部长时间 heartbeat**。
   疑似 finalize/等待时序问题，与 task 重开本身无关（重开前串行路径也有类似尾部等待）。
2. **前端折叠呈现未做**：子任务过程目前以原始嵌套子图事件混在流里；需按 §3 给前端
   `langchain-stream-parser.ts` 加折叠（"正在并行处理 N 个子任务"）。
3. 偶见子代理把 `mkdir -p $ARTIFACTS_DIR` 字面量未展开建出垃圾目录（shell 卫生，
   既有问题非本次引入）。
4. `test_agent_runtime_policy.py` 两项（slot_gating/max_inflight）在本机因 live
   config_kvs 状态而失败——**既有失败、与本次改动无关**（已用 git stash 在干净基线复现）。

## 1. 背景与结论

### 1.1 需求来源

用户希望支持"长任务/子任务的异步任务"，并记得 deepagents 支持。澄清后锁定为：
**单员工内部并行子任务** —— 一个员工在一次回答里，把活拆成多个独立子任务并发执行，
而不是一个一个串行做。

### 1.2 deepagents 0.6.7 实际提供的两套机制（已读源码确认）

> 注意：仓库 `MIGRATION_deepagents.md` 记录的是 0.5.3，但当前 `.venv` 实际解析到
> **0.6.7**（`uv run python -c "import deepagents; print(deepagents.__version__)"` → `0.6.7`）。
> 本设计以 0.6.7 源码为准。迁移文档与实际版本的偏差应另行更新（见 §8 待办）。

| 机制 | 工具 | 执行方式 | 是否共享本地 backend/产物 | 适配本需求 |
|------|------|----------|---------------------------|------------|
| `SubAgentMiddleware` | `task(description, subagent_type)` | **同进程嵌套图 `.ainvoke()`** | ✅ 共享父 `backend` 与 state | ✅ **本设计采用** |
| `AsyncSubAgentMiddleware` | `start_async_task` / `check_async_task` / ... | 远程 Agent Protocol / LangGraph 服务（需 `graph_id`+`url`+SDK） | ❌ 跑在独立部署，不共享本地 shell/artifacts | ❌ 需额外基础设施，非本需求 |

**关键源码事实**（`deepagents/graph.py`）：

- `create_deep_agent(subagents=[])`（当前 `employee.py:211` 的写法）会**自动注入**一个
  `general-purpose` 同步 subagent（除非 harness profile 显式禁用），并因此暴露 `task` 工具。
- 自动注入的 general-purpose subagent **继承父 agent 的 tools 与 backend**：
  - `graph.py:692` → `"tools": _tools or []`（即我们传入的 `extra_tools`：`shell_execute_tool`、`remember_memory_tool` 等）
  - `graph.py:663` → `FilesystemMiddleware(backend=backend)`（即我们的 `SkillAwareShellBackend`）
- 因此 **`task` 工具与共享产物目录"现在就已经生效"**。子任务写入 `artifacts_dir`
  的文件，父 agent 与后续子任务都能看到（符合"共享父会话产物目录"诉求）。

### 1.3 并行语义（必须明确，避免误解）

`task` 的并行是**轮内并行（intra-turn）**，不是后台异步：

- 若模型在**同一条 assistant 消息里发出多个 `task` 调用**，LangChain 的 `ToolNode`
  会用 `asyncio.gather` 并发执行这些 `atask` 协程 —— 真并行。
- 但父 agent 的本轮 `astream()` **必须等所有子任务返回后才结束**。它给你的是
  "3 个子任务同时跑"而非"先返回再后台跑完"。后者属于未选择的"长任务后台不掉线"层。

### 1.4 真正的根因（2026-06-13 实测修正）

> **重要修正**：本节早前写"task 现在就已生效、只缺提示词"——**这是错的**。
> 实测（在真实后端上对员工跑两轮，task 调用 0 次）+ 源码排查发现：
> **task 工具被一个安全 harness profile 显式关闭了。**

根因在 `apps/server/src/service/agent/checkpointer.py:22-36`：

```python
register_harness_profile(
    f"openai:{settings.deepagent_model or 'qwen2.5-72b-instruct'}",
    HarnessProfile(
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),  # ← 关掉 task
        excluded_middleware={"SummarizationMiddleware"},
        excluded_tools=frozenset({"execute"}),  # 主 agent 禁内置 execute，只给受管 shell_execute
        tool_description_overrides={"shell_execute": "..."},
    ),
)
```

- **为什么关**（注释原话）：避免子代理在未授权下通过 task tool 调用子代理执行 shell —— 是
  有意为之的执行面安全措施，与 `excluded_tools={"execute"}` 配套。
- **机制**：deepagents `graph.py:658` `if gp_profile.enabled is not False and not any(...)`
  → `enabled=False` 时不注入 general-purpose → `inline_subagents` 空 →
  `graph.py:725 if inline_subagents:` 假 → **SubAgentMiddleware 不挂、`task` 工具根本不暴露**。
- **profile 命中**：`deepagent_model` 实测 = `qwopus3.6-35b-a3b-v1`（昇腾部署），
  profile key = `openai:qwopus3.6-35b-a3b-v1`，与 `build_chat_model` 产出的模型精确匹配。
- **验证陷阱**：直接 `create_deep_agent(subagents=[])` 验证会看到 task（auto-inject GP），
  那是**绕过了 profile**，会误判"已生效"。必须走完整 `get_agent` 才反映真实行为。

所以要支持并行子任务，**第一步不是提示词，而是重新打开 general-purpose subagent**，
并在打开的同时**保住当初关它的安全理由**——这正是下面单元 B' 要做的。剩余缺口：

1. **task 被安全 profile 关闭**（根因，单元 B' 解决）。
2. **重开后子代理的安全管控** —— 决策（2026-06-13）：子代理**能干活但只走受管
   `shell_execute`**（同样禁内置 `execute`、同样 intent/审计），与主 agent 同一道门。
3. **没有并发上限/信号量** —— `task` 子任务在"一个已准入的会话流"内部跑，
   **绕过**现有 `registry.can_admit` / `MAX_CONCURRENT_PER_EMPLOYEE` 阀门；员工一次
   fan-out 8 个子任务 = 单槽下 8 路嵌套图并发，可能重演昇腾单卡 GPU 槽饥饿
   （见 vLLM 单卡抢占记录）。默认上限 = **3**。
4. **模型是否会自发 fan-out 未知** —— 重开前测不了（工具没暴露）；重开后需复测
   `qwopus3.6-35b-a3b`，若仍不自发拆分，则提示词（单元 C）+ few-shot 是否够用待定。
5. **前端无折叠呈现** —— 子任务作为嵌套子图，事件已被 deepagents 转发到父流
   （`SubagentTransformer` 打标），但前端未做"折叠呈现"。

## 2. 总体方案

不引入任何新基础设施。**先重开被安全 profile 关掉的 task，再加管控与呈现**：

1. **单元 B'（最高优先级，根因）**：重新打开 general-purpose subagent（`enabled=True`），
   但给子代理与主 agent **同一道安全门**：禁内置 `execute`、只给受管 `shell_execute`。
2. **单元 A**：显式 SubAgent spec（替换 `subagents=[]`）—— 可控地声明 general-purpose
   及其工具/中间件（与 B' 协同：spec 里就把子代理工具限定为受管集合）。
3. **单元 B**：并发信号量（限制单父 agent 同时跑的子任务数，默认 3，护单卡 GPU）。
4. **单元 C**：提示词启用（已做，因 task 被关而暂未生效，B' 后才有意义）。
5. **前端折叠呈现**。

### 2.1 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| task 当前状态 | **被 `checkpointer.py` 安全 profile 显式关闭** | 实测根因；非模型问题（见 §1.4） |
| 是否重开 task | **重开，但给子代理同样管控** | 拿回并行能力又不破当初的执行面安全边界 |
| 子代理 shell 能力 | **能干活，只走受管 `shell_execute`** | 禁内置 execute、同样 intent/审计；与主 agent 同门（2026-06-13 决策） |
| subagent 挂载方式 | **显式 SubAgent spec** | 比默认注入可控；能精确限定子代理工具集与信号量；改动仍小 |
| 子任务产物/文件 | **共享父会话产物目录** | 符合 deepagents 默认（子继承父 backend）；上游产出下游可见 |
| subagent 形态 | **单个通用 subagent + 并发批量** | 改动最小；不新增专业角色；靠 ToolNode 原生并发 |
| 子任务并发上限 | **3（可配 `settings.subagent_max_parallel`）** | 中道：多路拆分有意义又不打爆昇腾单卡 GPU 槽 |
| 前端呈现 | **折叠：只显进度 + 最终综合** | 与群协作"只展示最终交付"一致（`execution.py:91` 同源决策） |

## 3. 组件设计（三个独立单元）

### 3.1 单元 A：显式 general-purpose SubAgent spec

**做什么**：在 `get_agent` 中构造一个显式的 `SubAgent` 字典，替换 `subagents=[]`。

**怎么用**：
```python
from deepagents.middleware.subagents import GENERAL_PURPOSE_SUBAGENT

employee_subagent = {
    **GENERAL_PURPOSE_SUBAGENT,           # name="general-purpose", 基础 description/prompt
    "model": model,                       # 与父同模型（或按需降配）
    "tools": extra_tools,                 # 显式传入 = 与父同工具集（含 shell_execute）
    "system_prompt": <对齐派单执行的子任务 prompt>,  # 见单元 C
    # middleware 由 create_deep_agent 内部补齐基础栈（Filesystem/Todo/Summarization/...）
}
agent = create_deep_agent(..., subagents=[employee_subagent], ...)
```

> 注意：显式传 `SubAgent`（非 `CompiledSubAgent`）时，`create_deep_agent` 会自动为它
> 预置基础 middleware 栈（`graph.py:588-651`，含 `FilesystemMiddleware(backend=backend)`），
> 所以**共享 backend 仍自动成立**，无需手动构造 middleware。

**依赖**：`deepagents.middleware.subagents.GENERAL_PURPOSE_SUBAGENT`、现有 `extra_tools`、`backend`。

**边界**：此单元只改"如何声明 subagent"，不改并发数也不改 prompt 内容（那是 B、C）。

### 3.2 单元 B：子任务并发信号量

**做什么**：限制单个父 agent 同时在跑的 `task` 子任务数（默认上限 = 3，可配）。

**为什么**：保护昇腾单卡 GPU 槽，避免"一槽内 N 路嵌套图"打满显存/线程池。

**怎么用（两种实现，二选一，实现期定）**：

- **B1（首选，侵入小）**：给 subagent 挂一个自定义 `AgentMiddleware`，在 `awrap_model_call`
  / 工具执行处用一个 **per-parent `asyncio.Semaphore`** 限流。信号量按
  `conversation_id` 维度建一个（模块级 dict），上限读 `settings`。
- **B2（备选）**：把 general-purpose subagent 的 `runnable` 包一层，使其 `ainvoke`
  先 `await semaphore.acquire()`。需用 `CompiledSubAgent`，改动略大。

**配置**：新增 `settings.subagent_max_parallel`（默认 3）。0 或 1 = 实质串行（保留 task 隔离价值，但不并发）。

**边界**：信号量只管"同时跑几个子任务"，不管"总共能拆几个"（后者靠 prompt 引导 + recursion_limit 兜底）。

**依赖**：`asyncio.Semaphore`、`get_settings`、`conversation_id`。

### 3.3 单元 C：提示词启用（核心修复）

**做什么**：
1. 在 `build_system_prompt` 增加一段**中文 `task` 使用指南**，告诉员工：
   - 当有 N 块**相互独立**的工作（独立调研 / 独立文件 / 独立分析）时，
     **在同一轮发出多个 `task` 调用**以并行执行。
   - 仅用于"真正独立、多步、吃上下文"的子块；琐碎的一两个工具调用**不要**用 task。
   - 子任务产物写入共享产物目录，文件名互不冲突；父 agent 负责最后**综合**各子任务结果。
   - 对齐既有约定：被派单执行时不要请求澄清、不要等确认（与 `execution.py` 的
     `dispatch_directive` 同口径）。
2. 给 general-purpose **subagent 自己**的 `system_prompt` 也加一句：
   "你只把最终结果返回给上层；中间过程上层看不到，最终消息要自包含完整答案。"
   （deepagents `DEFAULT_SUBAGENT_PROMPT` 已有英文版，这里给中文对齐版。）

**怎么用**：在 `prompts.py:build_system_prompt` 末尾拼接一个 `build_subtask_parallel_section()`。

**边界**：纯 prompt，无行为副作用；可用环境变量 `AGENT_SUBTASK_HINT=0` 关闭以便 A/B。

**依赖**：`prompts.py`。

## 4. 数据流

```
员工执行会话（已被 registry 准入，占 1 槽）
  │
  └─ agent.astream()  父 agent 本轮
        │
        ├─ 模型读到「task 并行指南」(单元 C)，判断有 3 块独立工作
        │
        ├─ 同一条 assistant 消息发出 3 个 task() 调用
        │     │
        │     └─ ToolNode 并发执行 3 个 atask 协程 (asyncio.gather)
        │           │  ← 单元 B 信号量限流：最多同时 N 个 acquire
        │           │
        │           ├─ subagent#1.ainvoke()  共享 backend → 写 artifacts/sub1.md
        │           ├─ subagent#2.ainvoke()  共享 backend → 写 artifacts/sub2.md
        │           └─ subagent#3.ainvoke()  共享 backend → 写 artifacts/sub3.md
        │                 │
        │                 └─ 各自返回「最终消息」作为 ToolMessage 回父 agent
        │
        ├─ 父 agent 看到 3 个 ToolMessage（子任务结果），综合
        │
        └─ 流正常结束 → _finalize_task_stream(...)  (与现有完全一致)
```

**前端折叠呈现（单元 C 的 UI 侧 + 既有流解析）**：
- 子任务嵌套子图事件被 deepagents 转发到父流，`SubagentTransformer` 已打标
  `ls_agent_type="subagent"`。
- 前端流解析器（`langchain-stream-parser.ts`）**折叠**这些 subagent 段：
  不逐字渲染子任务独白，只显示一行"正在并行处理 N 个子任务…"（计数来自 task 调用数），
  子任务完成后只渲染父 agent 的综合输出。
- 与群协作"只展示最终交付、不刷成员过程"决策一致。逐字过程仍可在
  LangSmith / 后端日志回溯。

## 5. 错误处理

| 情况 | 行为 |
|------|------|
| 某子任务内部异常 | `atask` 的 except 返回错误字符串作为 ToolMessage，父 agent 看到后可重试/降级/在综合里说明，不炸整轮 |
| 子任务超时 | 沿用 subagent 自带 `SummarizationMiddleware`/模型超时；父轮整体仍受现有 120s 无产出超时与 `_finalize_task_stream` 兜底 |
| 信号量满 | 多出的子任务在 `acquire` 处等待（不是拒绝），排队执行；不绕过 GPU 保护 |
| 递归过深/无限拆分 | `create_deep_agent` 默认 `recursion_limit=9999` 兜底；prompt 明确"仅用于独立多步块"抑制滥用 |
| 写文件冲突 | prompt 要求子任务用**不同文件名**；共享目录不做锁（YAGNI），靠命名约定 |

## 6. 测试策略

- **单元测试**
  - 单元 A：构造 `get_agent` 后断言其工具集含 `task`；断言 general-purpose subagent
    的 tools 含 `shell_execute`（通过 middleware 自省或一次空跑）。
  - 单元 B：信号量按 `conversation_id` 隔离；上限生效（mock 子任务 sleep，验证并发不超 N）。
  - 单元 C：`build_system_prompt` 输出含 task 指南关键句；`AGENT_SUBTASK_HINT=0` 时不含。
- **集成测试（最小可信）**
  - 给员工一个明确可并行的活（"分别调研 A/B/C 三个主题各写一个文件并汇总"），
    跑 `agent.astream()`，断言：① 出现 ≥2 个 task 调用；② 三个文件都落到共享 artifacts；
    ③ 父 agent 末条消息是综合结论。
  - 前端：mock 一段含 subagent 标记的 SSE，断言流解析器折叠为"并行处理 N 个子任务"行。
- **回归**：`subagents=[]` → 显式 spec 后，普通（非并行）单轮对话行为不变。

## 7. 实施顺序（建议）

1. 单元 C（prompt）—— 单独上线即可让能力"被用起来"，风险最低，可先验证价值。
2. 单元 A（显式 spec）—— 为 B 铺路；不改行为。
3. 单元 B（信号量）—— GPU 保护，依赖 A。
4. 前端折叠呈现 —— 可与 1 并行开发，最后联调。

## 8. 非目标 / 待办

**非目标（本设计明确不做）**：
- 跨进程/远程后台长任务（`AsyncSubAgentMiddleware`，需 Agent Protocol 部署）。
- 编排层 DAG 的异步化改造。
- 专业角色 subagent（researcher/coder/writer 等）。
- 子任务过程的逐字流式展开（选择了折叠）。

**待办（本设计之外，顺手记录）**：
- 更新 `MIGRATION_deepagents.md`：实际版本是 0.6.7 而非 0.5.3。
- 若后续需要"真后台长任务"，再单独立 spec 评估 `AsyncSubAgentMiddleware` +
  自建 Agent Protocol 服务（与现有 `registry`/`TaskExecutionLog` 如何对接）。

## 9. 关键文件索引

- `apps/server/src/service/agent/employee.py:207-238` — `create_deep_agent` 调用点（单元 A/B 落点）
- `apps/server/src/service/agent/prompts.py:136` — `build_system_prompt`（单元 C 落点）
- `apps/server/src/service/agent/orchestrator/execution.py:449-458` — 现有派单口径（prompt 对齐参考）
- `.venv/.../deepagents/graph.py:653-709` — general-purpose subagent 自动注入与 tools/backend 继承
- `.venv/.../deepagents/middleware/subagents.py` — `task` 工具、`SubAgent` spec、`GENERAL_PURPOSE_SUBAGENT`
- `.venv/.../deepagents/middleware/async_subagents.py` — （非目标）远程异步 subagent
- `apps/web/src/lib/chat/langchain-stream-parser.ts` — 前端流解析（折叠呈现落点）
