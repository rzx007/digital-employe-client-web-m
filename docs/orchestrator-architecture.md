# 总管（Orchestrator）架构与工作流程

> 本文是**代码实证**的总管系统地图——鸟瞰图、架构图、工作流程图，配关键模块清单与设计不变量。
> 与抽象方法论 [agent-orchestration-methodology.md](agent-orchestration-methodology.md) 互补：那篇讲「为什么这么设计」（可迁移原则），本篇讲「代码里到底怎么跑」（真实模块/函数/文件）。
> 适用分支：`feat/orchestrator-centric`。所有路径相对 `apps/server/`（前端另注）。

---

## 1. 鸟瞰图（Bird's-eye）

总管是数字员工团队的**唯一对话入口**：理解用户意图 → 拆解组队 → 后台派活 → 回流整合质检 → 交付；员工在幕后独立会话执行，从不直接对用户说话。一切「成长」沉淀进各员工私有大脑。

```mermaid
flowchart TB
    User([用户]) <-->|唯一对话面| Orch[总管 Agent]

    Orch -->|① 决策链: 查员工/技能| Roster[(团队名册 + 能力画像)]
    Orch -->|② 拆解派活契约| Plan[编排计划 DAG]
    Plan -->|③ 确认/低风险自动执行| Dispatch[完成驱动调度器]

    Dispatch -.后台并行.-> E1[员工A 独立会话]
    Dispatch -.后台并行.-> E2[员工B 独立会话]
    Dispatch -.后台并行.-> E3[员工C 独立会话]

    E1 & E2 & E3 -->|产物同写同读| Artifacts[(项目共享产物区<br/>$ARTIFACTS_DIR)]
    E1 & E2 & E3 -->|完成事件: 摘要+状态| Reentry[事件驱动再入]
    Reentry -->|④ 唤醒总管整合+质检| Orch

    E1 & E2 & E3 -.终态零成本捕获.-> Brain[(各员工私有大脑<br/>journal/memories/profile/skills)]
    Brain -->|后台异步复盘| Learn[学习闭环<br/>反思 critic + librarian]
    Learn -->|能力画像回喂路由| Roster
    Learn -->|技能候选待确认| Growth[成长面板]
    Growth -->|人点「采纳」| Brain

    classDef hot fill:#fff3cd,stroke:#d39e00;
    class Orch hot;
```

**三条贯穿原则**（对应方法论 §1）：唯一对话面 · 共享桌 + 私有脑 · 涌现式成长（复用优先、复盘防膨胀）。

---

## 2. 架构图（模块与依赖）

总管相关代码集中在 `src/service/agent/orchestrator/`，学习闭环在 `src/service/learning/` 与 `src/service/reflection_engine.py`，回流驱动挂在 `src/service/stream_registry.py` + `src/server.py`。

```mermaid
flowchart LR
    subgraph Entry[入口/编排层 orchestrator/]
        AG[agent.py<br/>构建总管 agent<br/>装提示词/工具/HITL]
        PR[prompts.py<br/>系统提示词 +<br/>执行快照注入]
        TO[tools/*.py<br/>plans/employees/<br/>skills/tasks]
        CP[confirmation_policy.py<br/>确认门分级]
        TV[task_validation.py<br/>DAG 自检:成环/越界]
    end

    subgraph Exec[执行/调度层]
        EX[execution.py<br/>execute_plan<br/>start_immediate_tasks]
        DS[dependency_scheduler.py<br/>完成驱动 DAG<br/>级联跳过/QA放行]
        RW[rework.py<br/>同会话返工]
    end

    subgraph Reentry[再入/汇报层]
        RE[reentry.py<br/>trigger_incremental_report]
        RD[report_debouncer.py<br/>去抖批量唤醒]
    end

    subgraph Learn[学习闭环 learning/ + reflection]
        JN[journal.py<br/>零成本捕获]
        RF[reflection_engine.py<br/>信号 critic→memory]
        LB[librarian.py<br/>画像/去重/技能晋升]
        QA[qa_delivery_check.py<br/>交付物代码兜底]
    end

    subgraph Infra[运行时基建]
        SR[stream_registry.py<br/>流调度+finalize 钩子]
        SV[server.py<br/>on_task_finalized 装配]
        ES[employee_service.py<br/>成长大脑/采纳候选]
    end

    AG --> PR & TO & CP
    TO --> TV & EX
    EX --> DS
    DS --> RW
    SR -->|finalize| JN & RF & LB & RD & SV
    SV --> DS
    RD --> RE
    RE --> AG
    PR -. 注入快照时调用 .-> QA
    LB -. 写技能候选 .-> ES
    LB -. 读 .-> JN & RF
```

**层与职责**

| 层 | 模块 | 职责 |
|----|------|------|
| 入口/编排 | `agent.py` `prompts.py` `tools/` | 构建总管 agent、系统提示词、对外工具（建计划/管员工/管技能） |
| 决策守卫 | `confirmation_policy.py` `task_validation.py` | 确认门分级、计划 DAG 结构自检 |
| 执行/调度 | `execution.py` `dependency_scheduler.py` `rework.py` | 派发根任务、完成驱动放行下游、级联跳过、返工 |
| 再入/汇报 | `reentry.py` `report_debouncer.py` | 事件驱动唤醒总管、去抖批量防风暴 |
| 学习闭环 | `journal.py` `reflection_engine.py` `librarian.py` `qa_delivery_check.py` | 捕获→提炼→复盘→回喂；交付物代码核验 |
| 基建 | `stream_registry.py` `server.py` `employee_service.py` | 流生命周期 + finalize 钩子装配 + 成长大脑读写 |

---

## 3. 工作流程图（请求生命周期）

一条用户需求从进入到交付的完整时序（含低风险自动执行、确认门、DAG 放行、质检返工）。

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant O as 总管 Agent
    participant V as task_validation
    participant C as confirmation_policy
    participant X as execution / scheduler
    participant E as 员工(后台会话)
    participant F as finalize 钩子
    participant R as 去抖器+再入

    U->>O: 发需求
    Note over O: 决策链(不得跳步)<br/>1 查员工 2 查本地技能<br/>3 搜市场 4 建议招人/装技能
    O->>V: create_orchestration_plan(tasks)
    V-->>O: DAG 自检(成环/越界/自依赖)通过
    O->>C: compute_requires_confirmation
    alt 单任务 + 只读 + 无cron + 无破坏词
        C-->>O: 免确认
        O->>X: 自动 execute_plan
    else 多任务/破坏性/长文档/定时
        C-->>O: 需确认
        O-->>U: 展示计划卡片(等确认)
        U->>O: 确认
        O->>X: confirm_orchestration_plan → execute_plan
    end
    X->>E: 派发根任务(依赖未满足的暂不发)
    Note over E: 自包含派单、HITL-off、跑到底

    loop 每个员工任务终态
        E->>F: 流结束 _finalize_task_stream
        Note over F: ①journal 捕获(零成本)<br/>②信号反思→memory<br/>③阈值→librarian 复盘<br/>④通知去抖器 ⑤驱动 DAG
        F->>X: on_employee_task_completed<br/>(成功→评估后继 / 失败→级联跳过)
        F->>R: debouncer.notify(orch_conv)
    end

    R->>O: 去抖窗口到期 → trigger_incremental_report<br/>(新结果摘要 + 整盘快照 + 代码抽检标红)
    Note over O: 一线质检: 对照派活契约逐项判定<br/>高风险交付看 qa_delivery_check 抽检结果
    alt 达标
        O->>X: 结束本轮 → release_accepted_downstream<br/>(盖 qa_accepted_at → 放行下游)
        X->>E: 派发就绪后继
    else 不达标
        O->>E: redispatch_task(同会话续聊返工, ≤2次)<br/>+ 作废下游待重跑
    end
    O-->>U: 进度骨架(计数+状态清单) / 最终交付
```

### 3.1 确认门分级（P1-A）

```mermaid
flowchart TD
    P[create_orchestration_plan] --> Q{单任务?}
    Q -->|否| Need[需确认]
    Q -->|是| Q2{有 cron?}
    Q2 -->|是| Need
    Q2 -->|否| Q3{output_tier=small?}
    Q3 -->|否| Need
    Q3 -->|是| Q4{prompt/任务名含<br/>破坏性关键词?}
    Q4 -->|是 删除/转账/发布/rm...| Need
    Q4 -->|否| Auto[免确认 → 直接 execute_plan]
    Need --> Card[展示卡片等用户确认]
```

> 被派员工以 `enable_hitl=False` 执行，自动放行后无 HITL 拦截，故判定**保守**：宁可误确认、不可误放行。见 `confirmation_policy.py`。

### 3.2 完成驱动 DAG 调度与 QA 门控

```mermaid
flowchart TD
    Done[某员工任务终态] --> Eval{on_employee_task_completed<br/>从 DB 真实状态重算整盘}
    Eval -->|前置失败| Skip[级联跳过下游<br/>fail-fast 传播]
    Eval -->|前置全部 QA 接受| Disp[派发就绪后继<br/>注入前置产物简报]
    Eval -->|全部定局| Settle[记录 all_settled<br/>最终整合由去抖器接管]

    subgraph QA[总管评审轮收尾]
        Acc[判定上游达标] --> Rel[release_accepted_downstream<br/>盖 qa_accepted_at]
        Rel --> Disp
    end
```

关键点：
- **真 DAG**：后继在前置**真正完成且被总管 QA 接受**后才派（`qa_accepted_at`），不是启动时就递减计数（修了历史伪 DAG）。
- **DB 派生状态**：每次从 `TaskExecutionLog` 重算，进程重启不丢、并发无需内存锁。
- **返工**：`redispatch_task` 在**原员工会话续聊**（非新建），并**作废下游子树**待上游重新达标后自动重跑；每任务自动返工上限 2 次。

---

## 4. 学习闭环（让员工越用越厚）

```mermaid
flowchart LR
    subgraph 便宜/always-on
        J[①捕获 journal.py<br/>任务名/状态/工具/结论<br/>零模型调用]
    end
    subgraph 信号触发/后台
        S[②提炼 reflection_engine.py<br/>失败后成功 / 返工后达标<br/>→ critic → memories/AGENTS.md]
    end
    subgraph 阈值触发/后台
        L[③复盘 librarian.py<br/>generate_profile 读 journal+教训<br/>consolidate_memory 安全去重<br/>promote_skills 重复打法→技能候选]
    end
    subgraph 消费
        Route[④回喂 list_workspace_employees<br/>带能力画像 → 总管路由选人]
        Adopt[成长面板 → 人点采纳<br/>候选 → 正式技能]
    end

    J --> S --> L
    J --> L
    L -->|profile.md| Route
    L -->|skill_candidates/| Adopt
    S -.教训.-> L
```

**两种经验、两道闸门**（方法论 §3）：
- **软知识（教训）**：单次强信号即写 `memories/AGENTS.md`（失败后成功、返工后达标）。
- **硬知识（技能）**：**单次不晋升**——`promote_skills` 要求成功流水 ≥3 且体现同一套打法，才提炼成**技能候选**（`skill_candidates/<slug>.md`），且**只造候选、不自动转正**，人在成长面板点「采纳」才转为正式技能（`skills/<slug>/SKILL.md`）。

**QA 代码兜底**（`qa_delivery_check.py`）：注入执行快照时，若员工自报了交付物却在产物区找不到对应非空文件，快照里直接标红「疑似假交付」，不依赖总管主动抽检。自报判定两路控误报：① 二进制交付物（docx/pptx/xlsx/pdf）全文匹配；② 其余文件仅在含「交付动词」的行里取、排除脚本扩展名。

---

## 5. 员工私有大脑目录布局

```
<skill_path>/<employee_id>/        ← 大脑根 = resolve_employee_memories_dir(eid).parent
├── skills/<slug>/SKILL.md         ← 正式技能(agent 兜底加载源 + 成长面板展示)
├── skill_candidates/<slug>.md     ← 技能候选(待人确认, 自动晋升产出)
├── memories/AGENTS.md             ← 长期记忆/教训(reflection 写, librarian 去重)
├── journal/YYYY-MM-DD.jsonl       ← 结构化流水(零成本捕获, 复盘原料)
└── profile.md                     ← 能力画像(librarian 生成, 回喂路由)
```

产物则不在大脑里，而在**项目共享产物区** `$ARTIFACTS_DIR`（= `$WORKSPACE_DIR`）：全队同写同读、扁平、同名后写覆盖先写（并行写同名有 `basic_file_write` 告警兜底）。

---

## 6. 关键模块清单（代码导航）

| 文件 | 关键符号 | 作用 |
|------|---------|------|
| `orchestrator/agent.py` | `get_orchestrator_agent` | 构建总管 agent：模型/提示词/工具/HITL/产物根/执行快照 |
| `orchestrator/prompts.py` | `ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE`、`build_delegation_execution_context`、`build_employee_capability_context` | 系统提示词；每轮注入「整盘执行快照」（含 QA 抽检标红）；名册+能力画像 |
| `orchestrator/tools/plans.py` | `create_orchestration_plan`、`confirm_orchestration_plan`、`cancel_plan` | 建计划（校验+自检+低风险自动执行）/确认/取消 |
| `orchestrator/confirmation_policy.py` | `compute_requires_confirmation` | 确认门分级（仅只读单任务免确认） |
| `orchestrator/task_validation.py` | `validate_orchestration_tasks` | 同员工拆分拦截 + DAG 成环/越界/自依赖自检 |
| `orchestrator/execution.py` | `execute_plan`、`start_immediate_tasks`、`start_task_as_conversation` | 确认后派发根任务、起员工流 |
| `orchestrator/dependency_scheduler.py` | `on_employee_task_completed`、`release_accepted_downstream`、`invalidate_downstream` | 完成驱动放行、级联跳过、QA 接受放行、返工作废下游 |
| `orchestrator/rework.py` | `redispatch_task_in_session` | 同员工会话续聊返工（上限 2、gate 前置）；亦供用户「改改/重试」端点复用 |
| `orchestration_lifecycle.py` | `cancel_orchestration_plan`、`update_pending_plan_task`、`collect_plan_deliverables` | 取消计划；确认前编辑子任务(prompt/换员工)；聚合各子任务产出文件(回流主对话「团队交付物」卡，存在性过滤去临时脚本) |
| `orchestrator/reentry.py` | `trigger_incremental_report`、`trigger_orchestrator_reentry` | 用新结果+快照唤醒总管整合/质检 |
| `orchestrator/report_debouncer.py` | `ReportDebouncer`、`get_report_debouncer` | 去抖批量唤醒，防风暴，占线时延后补触发 |
| `reflection_engine.py` | `maybe_reflect_on_signal`、`detect_failure_then_success`、`detect_rework_then_success` | 信号闸门 critic → 写教训记忆 |
| `learning/journal.py` | `capture_journal_entry` | 终态零成本捕获结构化流水 |
| `learning/librarian.py` | `run_librarian`、`generate_profile`、`consolidate_memory`、`promote_skills` | 后台复盘：画像（含教训）/记忆去重/硬技能晋升 |
| `orchestrator/qa_delivery_check.py` | `check_log_delivery`、`detect_missing_delivery_artifacts` | 交付物真伪代码兜底（自报 vs 磁盘） |
| `stream_registry.py` | `_finalize_task_stream`、`on_task_finalized` | 流终态钩子：捕获/反思/复盘/去抖/驱动 DAG |
| `server.py` | `_on_task_finalized`（lifespan 装配） | 把终态事件接到调度器 + 推前端事件 |
| `employee_service.py` | `build_employee_growth_brain`、`adopt_skill_candidate`、`dismiss_skill_candidate` | 成长大脑只读聚合 + 候选采纳/忽略 |
| 前端 `growth-brain-section.tsx` | `GrowthBrainSection` | 成长面板：画像/技能/记忆/日志/**技能候选(采纳·忽略)** |

---

## 7. 关键设计不变量（改代码时勿破坏）

1. **唯一对话面**：员工永不直接对用户说话，所有人机交互（澄清/确认）只在总管层。
2. **自包含派单 + 员工无澄清**：员工 `enable_hitl=False`、拿到契约四要素（目标/输出/资源/非目标）跑到底，缺信息写进结果带回，不阻塞等人。
3. **真 DAG，完成驱动**：后继在前置**真正完成且 QA 接受**后才派；状态从 DB 派生，重启不丢。
4. **确认门保守**：仅「单任务 + 只读 + 无 cron + 无破坏词」免确认自动执行；其余必确认。
5. **质检结果导向 + 代码兜底**：对照派活契约判达标；高风险交付有 `qa_delivery_check` 代码核验标红，不全靠模型遵从。
6. **学习闭环：单次不晋升硬技能**：软知识（教训）单次可写；硬知识（技能）须重复+验证，且只产「候选」、人确认才转正。
7. **轻量再入 + 编排层与主上下文分离**：完成事件只带摘要+状态，去抖批量唤醒；子任务全过程留编排层，总管主上下文只收精炼结论。
8. **不自爆内部机制**：自动放行/DAG/快照注入/reported_at 等是内部规则，正文只对用户说人话。

---

## 8. 已知残留 / 待办（截至本文）

- **学习闭环小限制**（v1 可接受）：① `promote_skills` 在候选已存在时仍会先调一次 LLM 才跳过；② 近义 slug 可能产生多个近重复候选，靠人复审去重。
- **二次复盘其它残留**：单评审者 QA 无对抗校验；产物撞名仅事后日志、不 prevent；增量汇报 token 成本随计划规模上升；决策链线性、每需求重查名册；级联跳过为严格 fail-fast。

> 历史演进与优化记录见各 commit（`feat/orchestrator-centric`）；方法论层面的「为什么」见 [agent-orchestration-methodology.md](agent-orchestration-methodology.md)。
