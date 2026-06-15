# 总管中心 Agent 重构 · 总览与排序计划

> **For agentic workers:** 这是**方向级排序计划**，不是 bite-sized 执行计划。它把整次重构拆成有依赖顺序的子阶段；**每个子阶段实施前再单独出一份 bite-sized TDD 细化计划**（沿用阶段二/三 spec→子阶段模式）。
>
> 配套 spec：[2026-06-15-orchestrator-centric-agent-redesign-design.md](../specs/2026-06-15-orchestrator-centric-agent-redesign-design.md)
> 通用方法论：[agent-orchestration-methodology.md](../../agent-orchestration-methodology.md)

**Goal:** 把产品从"员工中心"翻成"总管中心"——总管唯一入口、组队后台真异步、员工退居幕后作为会成长的能力单元。

**Architecture:** **以 dev 为基底、复用 dev 现有对话流（不引入事件溯源、不动流式层）**，复用 dev 已有的异步派活 + DAG 调度 + 子任务面板 + 并发管控，新建"组队再入整合 + 学习闭环 + 成长面板"，退场员工单聊/群聊对话入口与群专属编排。

**基底分支：** `feat/orchestrator-centric`（**纯 dev 基底，不合并 feat/session-event-log**）。dev 全程不变。

---

## 0. 基底决策（2026-06-15 用户拍板，覆盖早前"阶段0合并"方案）

**早前方案是"阶段0 先把 feat/session-event-log（事件溯源）合进来再重构"。已废弃。** 用户决定：

- **以 dev 为基底**，开 `feat/orchestrator-centric` 单独分支。
- **对话流/流式输出沿用 dev 现状**（`use-conversation-session` / `langchain-chat-transport` / `conversation-runtime-bus` / `WorkspaceEventBus`），**不引入事件溯源会话地基**。
- 理由：不想再在流式输出上耗时间，dev 流式是跑通的；这次重构压根不碰它。复杂度略增但可控。

**对 spec 的影响（实现时以本节为准）**：
- spec §4.2/§10 写的"再入整合靠 `EventLogNotifier`/live_tail" → **改为靠 `WorkspaceEventBus`（task_completed 事件）+ 现有派活回流机制**（详见阶段 1）。
- spec 中一切"复用事件溯源底座（`service/session/*`、前端 `lib/session/*`）" → **作废**，改为复用 dev 对应底座（见 §2 复用表）。
- 子任务面板、并发中间件等 dev 近期成果**本就在 dev**，直接复用。

---

## 1. 架构红线（贯穿所有子阶段）

1. **总管是唯一对话面**——员工永不直接对话；只被派活、被只读查看。
2. **共享桌 + 私有脑**——产物落单一总管共享目录；技能/记忆/journal/profile 每个员工私有。
3. **涌现式成长**——名册从真实任务长出，复用优先于新建，复盘退休/合并防膨胀。
4. **不碰流式层**——沿用 dev 对话流；新编排逻辑干净写，但绝不重写流式/续流。
5. **子任务无澄清**——自包含派单、自主跑到底；HITL 只在总管层。
6. **退场放最后**——新路径成主路径并验收后，才删旧码（仿阶段 2D/3D）。

---

## 2. 复用 / 新建 / 退场总表（dev 基底）

| 处置 | 内容（dev 基底上的现状） |
|------|------|
| **复用** | **对话流/流式**（`use-conversation-session.ts`/`langchain-chat-transport.ts`/`langchain-stream-parser.ts`/`conversation-runtime-bus.ts`/`session-machine.ts`/`pick-message-display-source.ts`）；**异步派活 + DAG**（`orchestrator/execution.py` `start_task_as_conversation`/`execute_plan`、`dependency_scheduler.py` 完成驱动）；`OrchestrationPlan`(depends_on)/`TaskExecutionLog`/`WorkspaceEventBus`(task_started/completed/failed)；并发管控（`runtime.py` `MAX_CONCURRENT_PER_EMPLOYEE=2`、`subagent_concurrency.py`）；子任务面板（`subtask-panel-store.ts`/`subtask-panel.tsx`/`use-conversation-subtasks.ts`/`useCuratorTaskExecutions`）；HITL 生命周期（`lib/chat/hitl/*`/`chat-composer-area.tsx`）；总管视图（`curator/curator-view.tsx`）；真实路径 + env 注入（`skill_shell_backend.py`）；成长面板落点（`contacts/contact-detail-panel.tsx` 的"成长数据"tab） |
| **新建** | 总管再入整合协调器（任务完成事件→唤醒总管整合轮，基于 `WorkspaceEventBus`）；学习闭环（journal 捕获 / critic 提炼 / librarian 复盘 / profile 维护）；员工成长面板（只读，扩展现有 tab）；工作目录回收为单一共享桌 |
| **退场** | 员工单聊对话入口（→只读成长面板）；群聊房间对话入口（`group-room-view.tsx`）；群专属编排（`tools/groups.py`/`group_room_service.py`/`GroupRoom`/`GroupRoomMember`/`group_api.py`）；`@` 保留但重定性为路由提示 |

---

## 3. 子阶段排序（每段独立可测、独立产出价值）

```
阶段1 组队后台+再入整合(脊柱) ──▶ 阶段2 学习闭环 ──▶ 阶段3 成长面板 ──▶ 阶段4 旧系统退场
   ↑ 含：共享桌回收 + @重定性        ↑ 依赖1的子任务执行   ↑ 依赖2的脑产物    ↑ 全部就绪后
```

> **没有"阶段0"了**——纯 dev 基底，直接从阶段 1 开始。

### 阶段 1：总管唯一入口 + 组队后台 + 再入整合（脊柱）

- **目标**：让"帮我组个团队"端到端跑通——总管拆 Plan → 后台派活 → 任务完成**事件驱动唤醒总管整合轮** → 整合交付。这是整次重构的脊柱。
- **复用**：`start_task_as_conversation` 异步派活、`dependency_scheduler` 完成驱动、`OrchestrationPlan`(depends_on)、`TaskExecutionLog`、子任务面板、`WorkspaceEventBus`、dev 对话流（整合轮的流式走它）。
- **新建/改造**：
  1. **共享桌回收**（前置子任务）：`workspace_paths.py` `resolve_workspace_dirs` + `skill_shell_backend.py` env 注入 + `resource_service.py` 沙箱，从"员工级 `employee-<id>/artifacts/conv-<id>`"收为"单一总管共享桌 `orchestrator-workspace/`（子任务 `task-<id>/` 分目录）"。派活时所有员工 cwd 指向同一共享桌。
  2. **再入整合协调器**（★ 核心新难点，**dev 基底版**）：子任务完成 → 现有 `WorkspaceEventBus` 已发 `task_completed`（含 task_id/conversation_id）；新增"总管侧协调器"消费完成信号 → 一批/关键任务完成时触发"总管整合轮"——读 `TaskExecutionLog.output_json` 结论 + 产物路径，**用 dev 对话流发起一条 assistant turn**（非用户消息触发）整合交付。**复用并泛化群模式的回流**（`group_room_service.summarize_by_leader` → `origin_curator_conversation_id` 已有"汇总回流到总管会话"先例，把它从群专属泛化到普通总管派活）。串行+节流防风暴。固化 §4.3 两原则（通知轻量化：只读 output_json 摘要+路径；编排层/主上下文分离：全过程留子任务面板，整合轮只读结论）。
  3. **`@` 重定性**：mention 从"群成员直派"改为"给总管的路由提示"，总管组队时把对应员工绑到 Task（前端 `mention-plugin.tsx` + `metadata.mentions` 链路复用，后端语义改写）。
  4. **唯一入口（进行式）**：`chat-view.tsx` 把总管设为主入口/默认；员工单聊入口本阶段先不删（阶段 4 删），但新建需求默认进总管。
- **验收**（端到端手测）：组队（单/多角色）、后台并行执行、进度面板、任务完成总管被唤醒整合、刷新/切回恢复（走 dev 现有续流）、@ 指定路由、共享桌全队互见产物。
- **后续**：实施前出 bite-sized TDD 计划（含共享桌回收、再入整合协调器、@重定性三块，可能再细拆）。

### 阶段 2：学习闭环

- **目标**：员工"越用越厚"——journal 自动捕获 → 信号提炼 → 定期复盘 → profile 回喂路由。
- **复用**：员工私有目录（`memories/` 已有）、后台执行、`TaskExecutionLog` 元数据（耗时/成败/产物路径捕获来源）。
- **新建**：
  1. **journal 捕获**：子任务终态（`_finalize_task_stream` 写 `TaskExecutionLog` 处）自动追加结构化流水（覆盖 §3.3 信号判定来源：任务/工具/成败/产物/耗时/成本），不调模型。
  2. **critic 提炼**：信号触发的后台异步 agent，读流水+信号 → 提炼 skill/memory；单次信号→软知识(memory)，重复/验证→硬知识(skill)。
  3. **librarian 复盘**：周期/阈值触发，合并去重/删过时/退休合并闲置员工 + 更新 `profile.md`。
  4. **回喂路由**：总管组队读 profile 选员工；选中员工技能常驻加载 + `搜记忆` 工具。
- **依赖**：阶段 1（要有子任务执行才有可捕获的轨迹）。
- **验收**：捕获 always-on、信号才提炼、单次不晋升技能、复盘合并/退休、profile 驱动路由。
- **后续**：出 bite-sized 计划；信号集（§7 Q3）实施前定稿。

### 阶段 3：成长面板（只读）

- **目标**：员工降级为"可只读查看成长"的履历卡。
- **复用/落点**：扩展现有 `contacts/contact-detail-panel.tsx` 的"成长数据"tab（已有执行指标）。
- **新建**：展示 profile（能力画像头条）+ 技能/记忆/journal/历史产物/被派记录；需新增后端聚合端点。
- **依赖**：阶段 2（脑产物 profile/journal 才有内容可展示）。
- **验收**：只读查看任一员工的画像/技能/记忆/历史；无对话入口。
- **后续**：出 bite-sized 计划。

### 阶段 4：旧系统退场

- **目标**：删旧码、收口，让总管中心成为唯一系统。
- **退场**：员工单聊对话入口（`chat-view.tsx` 路由到只读成长面板）；群聊房间对话入口（`group-room-view.tsx`）与残余群专属编排（`tools/groups.py`/`group_room_service.py`/`GroupRoom`/`group_api.py`/`test_group_*`）；任何过渡 flag。
- **依赖**：阶段 1+2+3 全部成主路径并验收（红线⑥：退场放最后）。
- **验收**：旧入口删尽、无悬空引用、全量测试绿、总管中心唯一可用。
- **后续**：仿阶段 2D/3D 退场清理出 bite-sized 计划（grep 确认零引用再删）。

---

## 4. 跨阶段开放问题（实施时定夺，均带 spec §7 暂定默认）

- 再入整合粒度默认（攒里程碑 vs 逐个回流）；"关键里程碑"判定规则（阶段 1 计划定）。
- 总管自主答 vs 转用户的边界（阶段 1）。
- 信号集是否够（阶段 2）。
- 跨重启策略（标中断重派 vs 自动续跑，阶段 1）。
- 名册手动干预（成长面板只读 vs 加轻操作，阶段 3）。
- 总管自身是否走学习闭环（暂定走，阶段 2）。

---

## 5. 分支与提交策略

- 基底：`feat/orchestrator-centric`（**纯 dev 基底，不合并 feat/session-event-log**）。
- 各阶段在基底上开子分支实施；bite-sized 计划逐任务 TDD + 频繁提交。
- dev 全程不变；何时把 `feat/orchestrator-centric` 回合 dev 由用户定。
- `feat/session-event-log`（事件溯源）暂时搁置，与本次重构解耦；是否将来再合由用户另行决定。
</content>
