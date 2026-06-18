# 总管「待放行/等待前置」状态(替代裸「未执行」)— 设计 spec

- 日期：2026-06-18
- 分支：feat/orchestrator-centric
- 关联：[2026-06-17-orchestrator-qa-dag-gating-design.md](2026-06-17-orchestrator-qa-dag-gating-design.md)（放行闸）、[2026-06-17-orchestrator-rework-invalidation-propagation-design.md](2026-06-17-orchestrator-rework-invalidation-propagation-design.md)

## 1. 背景与问题（冒烟取证）

放行闸把下游派发延到"总管评审轮结束"。于是评审轮内,下游(如文档办公助手)**尚未派发、没有执行日志**。此时总管看到的状态是**裸的「未执行」**——它**区分不了**「卡住了/出问题」与「待放行,马上自动开始」,于是 panic、一路升级到**自己写脚本抢活**(实测 bug:总管写 `gen_docx.py` 自己生成 docx,谎报员工已生成)。

**根因(已取证)**:总管读子任务状态有两处来源,都不表达"待放行":
- **整盘快照** `build_delegation_execution_context`(每轮注入):只遍历**有执行日志**的任务;未派下游**根本不出现**。
- **list_tasks 工具** `task_listing.py:197-199`:无 log 的 immediate 任务**裸显「未执行」**。

给总管**准确、不含歧义**的状态,比用 prompt 禁它"别抢活"更治本(本地模型不可靠遵守否定式指令)。

## 2. 目标 / 非目标

### 目标
- 对编排计划内**未派/待派**的任务,显示明确的**「待放行」/「等待前置」**状态,替代裸「未执行」——让总管一眼看出"它会自动开始、无需我干预"。
- 两个显示面(总管读状态处)都修：**list_tasks**(主动查)+ **整盘快照**(每轮默认注入)。

### 非目标
- **不**改派发/放行闸逻辑(纯展示/只读)。
- **不**碰独立任务/定时任务的状态显示(仅编排计划内任务)。
- **不**改前端(总管读的是后端文本)。

## 3. 设计

### 3.1 核心 helper（dependency_scheduler.py）
`waiting_status_for_task(db, task) -> str | None`：对**编排计划内、当前无在跑/终态 live log** 的任务,据 DAG 判其"为何没动":
- 加载 `task.orchestration_plan_id` 的 plan → `_load_plan_tasks` + `json.loads(plan.plan_json)` → `build_dependency_maps` 得 `dep_map[task.id]`(前置 ids)。
- `accepted = _load_accepted_task_ids(db, dep_ids)`：
  - `dep_ids` 为空(根任务)→ `"待派发"`（罕见；根任务通常已首发）
  - 所有 `dep_ids ⊆ accepted` → `"待放行"`（前置已通过质检，即将自动开始）
  - 否则 → `"等待前置"`（其中列未通过的前置任务名，如 `等待前置「热搜聚合」`）
- 非编排任务(无 plan)→ 返回 `None`（调用方回落原有文案）。
- 纯只读,复用现成 DAG 函数。

### 3.2 显示面 1：list_tasks（task_listing.py）
`task_listing.py:197-199` 现逻辑：`latest_log.run_status` if log else `("运行中" if scheduled else "未执行")`。
改为：无 live log 时先调 `waiting_status_for_task`；返回非 None 用它（待放行/等待前置/待派发），返回 None 才回落原「未执行」/「运行中」。

### 3.3 显示面 2：整盘快照（prompts.py `build_delegation_execution_context`）
现只列有 log 的任务。补充：
- 由 `orchestrator_conversation_id` 查其 `OrchestrationPlan`(`conversation_id == orch_conv_id`)→ `_load_plan_tasks`。
- 对计划内**没有 live log**(不在已列出的 logged 任务集)的任务,追加一段「**待派发/等待中的子任务**」，每行 `任务名 · <waiting_status_for_task 结果>`。
- 这样总管**每轮默认就看到**完整 DAG（已跑的 + 待放行的），不用 dig。
- 若计划全部已派/有 log → 该段为空，不显示。

### 3.4 prompt 对齐（prompts.py 模板）
把第 89 行「看到下游显示『未执行』是正常的」改为「看到下游『待放行』即正常——它会在你收尾后自动开始」（措辞跟新状态一致；不新增禁令）。

## 4. 改动面（纯后端只读/展示）
- `dependency_scheduler.py`：新增 `waiting_status_for_task`。
- `task_listing.py`：无-log 兜底接 helper。
- `prompts.py`：`build_delegation_execution_context` 追加"待派发/等待中"段；模板第 89 行措辞对齐。
- 无新列、无迁移、不碰派发/放行/前端。

## 5. 测试策略
- **helper**：前置全接受 → 「待放行」；前置未接受 → 「等待前置「X」」；根任务无前置 → 「待派发」；非计划任务 → None。
- **list_tasks**：计划内无-log 下游 → 表格状态列显「待放行」而非「未执行」。
- **快照**：含待派发下游的计划 → 快照出现「待派发/等待中」段、状态正确;全已派 → 无该段。
- **prompt 不变量门**：措辞改动不破断言。
- **基线**：后端 5 failed/+本特性测试，零新增。

## 6. 风险
- **多计划/历史计划**：一个 orch conv 可能有多个 plan（含历史已完成）。快照补段应只针对**当前活跃**计划的未派任务，避免把历史计划的任务也列进来——实现期按 plan.status 或"有未终态任务"过滤。
- **性能**：`waiting_status_for_task` 每调载一次 plan；计划内任务少,可忽略。list_tasks 已有反轮询闸,不额外加压。
- **与放行时机的关系**：本特性纯展示,不改放行在"轮结束"发生这一事实；只是把那段窗口的状态显示得不吓人。若后续仍想消除窗口本身（总管显式接受即时放行），是另一档(A 方案)，本期不做。

## 7. 验收对照
冒烟复现：热搜达标、文档待放行那一刻——总管 list_tasks/快照看到文档是**「待放行」**(而非「未执行」)→ 不再 panic、不再写脚本抢活,正常收尾让系统自动放行。
