# 阶段 2：学习闭环 · 总览与排序计划

> **For agentic workers:** 方向级排序计划，非 bite-sized。每子块实施前再出 bite-sized TDD 计划。
> 配套 spec：[redesign §3](../specs/2026-06-15-orchestrator-centric-agent-redesign-design.md)。基底 `feat/orchestrator-centric`（阶段1 已完成）。

**Goal:** 让员工"越用越厚"——轻量 journal 捕获 → 信号闸门 critic 提炼 → 定期 librarian 复盘 → profile 回喂路由。

**Architecture:** 对齐 spec §3 的"信号闸门"初心：**便宜的地方全自动(journal 捕获,不调模型)、贵且要质量的地方信号把关(critic)、自清理(librarian)**。复用 dev 已有的反思/大脑目录/后台 LLM/路由基建，但把现有"每任务自动反思"重构为信号触发。

---

## 0. 关键决策（2026-06-15 用户拍板）

**dev 现状**：`reflection_engine.run_reflection`（`stream_registry._finalize_task_stream` L2332-2343 调用）**每个员工任务完成就自动 LLM 反思**→写 `memories/AGENTS.md`，每员工 60s 限流。

**这与 spec §3"信号闸门、别每任务反思"冲突。用户决定：对齐 spec——重构成信号闸门。**
- 加轻量 journal 捕获（不调模型、always-on）作地基。
- 把 run_reflection 从"每任务自动反思"重构为"信号触发提炼"。
- 加 skill 晋升（单次→memory 软、重复/验证→skill 硬）、librarian 复盘、profile 回喂。

---

## 1. 信号集定稿（spec §7 Q3）

| 信号 | 现状数据 | v1 处置 |
|------|---------|---------|
| **失败后成功** | ✅ TaskExecutionLog 同 task 多条 run_status 可查 | **v1 做**：critic 自动触发，diff 成教训→memory |
| **显式记住** | ✅ `remember_memory_tool` 已有（agent 直接写） | **v1 复用**：已是 agent 自主写 memory，不另做 |
| **重复模式** | ⚠️ 需 journal 累积后分析 | **v1 做**：靠 librarian 扫 journal 识别→晋升 skill |
| **用户纠正** | ❌ 无显式信号（需 NLP/打标） | **延后**：需新埋点(消息语义分类)，v2 |
| **验收返工** | ❌ 无机制（需 validation 状态位） | **延后**：需新埋点(EmployeeTask/再入判定)，v2 |

> v1 信号集 = **失败后成功 + 重复模式**（critic/librarian 自动触发）+ 复用现有 **显式记住**。用户纠正/验收返工 留 v2（要先埋点）。

---

## 2. 复用 / 新建 / 退场总表

| 处置 | 内容（真实代码） |
|------|------|
| **复用** | 员工大脑目录解析 `resolve_employee_memories_dir`(paths.py:78，员工根=`<skill_path>/<employee_id>`)；后台一次性 LLM `build_chat_model`+`invoke`(factory.py:93)；记忆写入 `remember_memory_tool`/`append_memory_entry`；路由 `list_workspace_employees`/`build_employee_capability_context`(employees.py:100/prompts.py:111)；捕获点 `_finalize_task_stream`(stream_registry.py:2277-2410)；`TaskExecutionLog` 字段(task_id/employee_id/run_status/output_json/duration_ms/started_at) |
| **改造** | `reflection_engine.run_reflection`：每任务自动反思 → **信号触发 critic**（2B）；`build_employee_capability_context`：路由表加 profile（2D） |
| **新建** | journal 捕获(`<brain>/journal/`，不调模型，2A)；critic 信号提炼+skill 晋升(2B)；librarian 复盘(合并/退休/profile，2C)；`profile.md` 维护(2C)；profile→路由(2D) |

**大脑目录布局**（`<skill_path>/<employee_id>/`，brain 根 = `resolve_employee_memories_dir(employee_id).parent`）：
```
<skill_path>/<employee_id>/
├── skills/          (已有)
├── memories/AGENTS.md  (已有)
├── journal/         ← 新建(2A)：YYYY-MM-DD.jsonl 结构化流水
└── profile.md       ← 新建(2C)：能力画像，2D 喂路由
```

---

## 3. 子块排序（每块独立可测）

```
2A journal 捕获(地基,不调模型) ──▶ 2B critic 信号提炼(重构 run_reflection) ──▶ 2C librarian 复盘+profile ──▶ 2D profile 回喂路由
   ↑ always-on,最便宜              ↑ 失败后成功→memory               ↑ 重复→skill/合并/退休/写profile   ↑ list_workspace_employees 读 profile
```

### 2A：journal 捕获（地基，最先）
- **目标**：子任务终态自动追加一条结构化流水到 `<brain>/journal/YYYY-MM-DD.jsonl`，**不调模型**。
- **捕获字段**（覆盖信号判定来源）：task_id、task_name、status、approach(用了哪些工具/技能，从 `ConversationMessage.message_parts` 解析 tool_use)、产物路径、duration_ms、started_at、结论摘要(output_json.content 截断)。
- **挂载点**：`_finalize_task_stream`（与 run_reflection 同处，L2332 附近）；只 append、近乎零成本。
- **依赖**：无。**验收**：跑一个子任务→journal 多一条含 status/approach/duration 的 jsonl 行；失败/取消也记。

### 2B：critic 信号提炼（重构 run_reflection）
- **目标**：把每任务自动反思改成**信号触发**。v1 信号 = 失败后成功。触发时后台一次性 LLM 读 journal+相关轨迹→提炼教训→写 memory。
- **改造**：run_reflection 触发条件从"completed 就跑"改为"检测到信号才跑"（失败后成功：查 TaskExecutionLog 同 task 历史 failed→success）。单次信号→memory(软)；**不**在此晋升 skill(留 2C 重复验证)。
- **依赖**：2A(读 journal)。**验收**：普通成功任务**不**触发反思(省 GPU)；失败重试成功→触发→memory 多一条教训。

### 2C：librarian 复盘 + profile
- **目标**：周期/阈值触发后台复盘：扫 journal 识别**重复模式**→晋升 skill(硬)；合并去重 memory；退休/合并闲置员工；生成/更新 `profile.md`(能力画像)。
- **依赖**：2A(journal 累积)。**验收**：同打法重复 N 次→提议/生成 skill；profile.md 反映员工干过的活类型；闲置员工被标记。
- **注**：触发机制(定时 vs 阈值)实施前定；参照 consolidate-memory 模式。

### 2D：profile 回喂路由
- **目标**：总管组队读 profile 选员工。`build_employee_capability_context` 读各员工 `profile.md` 并入路由表/上下文。
- **依赖**：2C(有 profile)。**验收**：总管组队时能看到员工能力画像，按它挑人/复用老员工。

---

## 4. 跨子块开放问题

- 2A journal 是否记 token 成本：现无 token 追踪(只有 duration)，v1 只记 duration，token 留后。
- 2B 失败后成功的判定窗口(同 task_id 历史相邻两条？跨会话？)实施定。
- 2C librarian 触发(定时/阈值/手动)、skill 晋升是否需人确认(spec 倾向自动但单次不晋升)、退休策略(闲置多久)实施定。
- 2D profile 存盘(profile.md 文件 vs DB 字段)：本计划用 **profile.md 文件**(与 memories 一致，私有脑在文件系统，免 schema 变更)。
- 用户纠正/验收返工信号(v2)：需新埋点，本阶段不做。

---

## 5. 分支与提交
- 在 `feat/orchestrator-centric` 上继续；各子块逐任务 TDD + 频繁提交。dev 不变。
</content>
