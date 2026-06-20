# 设计 spec：技能「在用中自改进」(A) + 生命周期 curator (B)

> 来源：[reference-hermes-agent-learnings.md](../reference-hermes-agent-learnings.md) §二.A / §二.B 两条高价值借鉴的落地设计。
> 分支 `feat/orchestrator-centric`。日期 2026-06-20。
> 配套：[orchestrator-architecture.md](../orchestrator-architecture.md)、[learning-loop-self-evolution.md](../learning-loop-self-evolution.md)。

---

## 1. 背景与目标

### A. 技能在用中自改进
当前「越用越强」只有一条路：`librarian.promote_skills` 在「重复≥3 成功」时**新建候选**——**从不修订已有技能**，也不把「用户纠正/返工」喂进技能层（只写 memory）。结果：老技能用着发现错/缺/过时，没有就地修正的通道，错误会反复重演。

**目标**：员工带着某技能干活、发现它错/缺/过时时，能**就地把技能改对并持久化**，下次（自己和所有用同一技能的员工）都受益。

### B. 生命周期 curator
方法论 §2.2 写了「定期复盘退休/合并闲置专才与技能」防膨胀，但**未实现**——技能/候选只增不减，闲置技能与近重复候选越堆越多。

**目标**：保守地给技能/候选做闲置老化（active→stale→archived，**绝不删除**、可恢复、pinned 豁免）与近重复候选合并，治膨胀。

### 设计原则
- **架构分明、不打补丁**：优先收敛/接通既有机制，而非并行造新链路。
- 沿用既有学习闭环哲学，但 A 按用户决策走**直接修订**（见 §4 的安全配平）。
- B **保守优先**：只动技能与候选，员工只「建议归档」不自动动。

---

## 2. 非目标
- **不改技能存储模型**（保持「每员工私有副本 + 技能库文件源」，不引入软链接/全局共享）。
- **不做 OS 沙箱**（A 的直接修订靠备份+审计兜底，不是安全边界）。
- **不自动归档员工**（只对用户提示）。
- **不引入 DB 迁移**（B 状态存 brain JSON）。

---

## 3. 现状机制盘点（复用清单）

A/B 的绝大部分地基**已存在**，本设计是接通而非重造：

| 既有件 | 位置 | A/B 怎么用 |
|--------|------|-----------|
| `update_local_skill`（写技能库 SKILL.md + 元数据；内置技能自动 fork 到工作区） | [local_skill_service.py:797](../../apps/server/src/service/local_skill_service.py#L797) | **A 的落库出口** |
| `sync_local_skill_to_assignees`（库改后推送所有已分配员工：employee_skills 表 + 私有副本 + skills_json/meta_json 快照） | [employee_service.py:1072](../../apps/server/src/service/employee_service.py#L1072) | **A 的全员同步** |
| `skill_improvement_service.trigger_improvement_review`（低分+评论→LLM 分析） | [skill_improvement_service.py:20](../../apps/server/src/service/skill_improvement_service.py#L20) | **A 的信号/线索来源**（当前产物是死文件，本设计改其去向） |
| `SkillRating`（每次技能调用的 score + 关联 task/conversation + created_at） | [models/skill_rating.py](../../apps/server/src/models/skill_rating.py) | A 的低分信号；B 的使用记录 |
| `TaskExecutionLog.skill_id + created_at`（真实使用流水） | models/task_execution_log.py | **B 的 last_used 来源** |
| `reflection_engine`（返工后成功/失败后成功 信号 critic） | [reflection_engine.py](../../apps/server/src/service/reflection_engine.py) | A 的自动触发信号之一 |
| `_growth_brain_root_for(employee_id)` + `skill_candidates/` | [employee_service.py:36](../../apps/server/src/service/employee_service.py#L36) | B 的 `skill_lifecycle.json` 落点；近重复候选合并对象 |
| 员工 agent 工具注册 | [agent/employee.py:96](../../apps/server/src/service/agent/employee.py#L96) | A 的 `update_skill` 工具挂载点 |
| 技能可用集构造 `available_skills` | [agent/employee.py:76](../../apps/server/src/service/agent/employee.py#L76)（喂 prerouter + 系统提示两路） | B 的 archived 排除点（见 §5.3） |

**关键洞察**：`skill_improvement_service` 是条**断头路**——低分时 LLM 分析后写 `improvement-suggestion.md` 到**员工副本目录**（会被 materialize/重建冲掉），**既不进候选、也不落库、没人看**。A 收编它：分析结果改为驱动就地修订，而非死文件。

---

## 4. A 设计：技能在用中自改进

### 4.1 形态（按用户决策：直接改 + 落库 + 全员同步）

给**员工 agent** 增一个工具 `update_skill`。员工干活时若判定某**已加载技能**错/缺/过时，直接调用它就地修订；修订即写技能库文件并同步所有已分配员工。

```
update_skill(skill_name: str, new_content: str, reason: str) -> str
```
- `skill_name`：要修订的技能（须是本员工当前已加载的技能之一，否则拒绝）。
- `new_content`：修订后的完整 SKILL.md 文本（全量替换，匹配 `update_local_skill` 入参，避免 diff 解析脆弱）。
- `reason`：为何修订（错在哪/缺什么）——进审计事件，给用户看。

### 4.2 落库数据流

> ⚠️ **关键 plumbing（评审补正）**：`update_skill` 工具挂在 `get_agent()`（[employee.py:55](../../apps/server/src/service/agent/employee.py#L55)）里，闭包只有 `employee_id / conversation_id / skill_path / root_path`，**没有 `db` / `workspace_id` / `user_id`**。所以工具内部必须**自己开 DB session 并从 `employee_id` 反查 `workspace_id` + `user_id`**（查 `Employee` 行）。下游两个函数的**真实签名**：
> - `update_local_skill(skill_name, workspace_id, *, skill_md_content=..., target=...)`（[local_skill_service.py:797](../../apps/server/src/service/local_skill_service.py#L797)）
> - `sync_local_skill_to_assignees(db, *, user_id, workspace_id, skill_name)`（[employee_service.py:1072](../../apps/server/src/service/employee_service.py#L1072)）

```
员工 agent.update_skill(name, content, reason)
  └─ 0. 解析上下文：开 DB session；Employee = get(employee_id) → 取 workspace_id, user_id
  └─ 1. 守卫：name ∈ 本员工已加载技能？否→拒绝（防误改无关技能）
  └─ 2. fork-on-edit：确保该技能在工作区技能库有可编辑副本
  │       └─ 复用 update_local_skill 内置的 _fork_builtin_to_workspace 思路；
  │          远程直分配（无库文件）技能→先固化为工作区本地技能
  └─ 3. 版本备份：把改前 SKILL.md 存到 <技能库>/<name>/.history/<ts>.md（可回滚）
  └─ 4. update_local_skill(name, workspace_id, skill_md_content=content)   → 写库文件
  └─ 5. sync_local_skill_to_assignees(db, user_id=.., workspace_id=.., skill_name=name)
  │                                                       → 推送所有已分配员工副本 + DB + 快照
  └─ 6. 记审计事件（见 4.4），提交 DB，返回简短确认给 agent
```

**fork-on-edit 统一出口**：无论技能来自本地/内置/远程直分配，修订都收敛为「写工作区技能库文件」这一个真相点。内置技能已有 fork 先例（[local_skill_service.py:829](../../apps/server/src/service/local_skill_service.py#L829)），远程直分配技能补一条「首次修订即固化为本地技能」。

### 4.3 提示词引导（让 agent 知道能改、该克制地改）
在员工系统提示的技能段补一段（参照 Hermes 优先级阶梯）：
> 你加载的技能若在使用中发现**错误/缺步骤/已过时**，可用 `update_skill` 就地修正——**优先修你正用着的这个技能**，让它越用越准。仅在确有把握、且是技能本身的问题（非本次任务一次性特例）时才改；改动会同步给所有使用该技能的同事，故须**类级、通用、保守**，不写 session 专属内容。

### 4.4 安全配平（直接改的代价兜底）
用户选了「直接改、无审核门」以换即时性。为把「一次错改传播全员」的风险压住：
1. **改前版本备份**（4.2 步骤 3）：`.history/<ts>.md`，支持一键回滚（提供 `restore_skill_version` 端点 + UI 入口）。
2. **审计事件**：每次 update_skill 写一条学习闭环事件（员工、技能、reason、前后 hash），在成长面板/时间线**显式可见**——「员工 X 在对话中修订了技能 Y」。
3. **加载守卫**（4.2 步骤 1）：只能改自己**已加载**的技能，杜绝顺手改无关技能。
4. **硬底线复用**：update_skill 不经 shell，不涉及 [command_safety](../../apps/server/src/service/agent/command_safety.py)；但写入受技能大小上限（`client_skill_import_max_bytes`，update_local_skill 已校验）约束。

> 开放点（spec 评审关注）：是否给 update_skill 配一个**轻量确认档**（如总管层面对「修订他人正在用的高频技能」二次确认）？默认 v1 不配，靠备份+审计+回滚。

### 4.5 自动信号如何接入（收编 skill_improvement_service）
就地修订是**主路径**（agent 主动）。既有自动信号作为**线索**喂给 agent，而非各走各的：
- **低分信号**：`SkillRating` 低分(<3)+评论时，`skill_improvement_service` 仍做 LLM 分析，但产物**不再写死文件**——改为：把「该技能疑似有问题 + 分析摘要」作为**下次该员工加载此技能时的提示**注入（或生成一条审计待办），引导 agent 评估是否 update_skill。
- **返工信号**：`reflection_engine` 检出「带技能 X 返工后才成功」→ 同样作为线索注入。

> v1 范围：先落 `update_skill` 工具 + 提示词 + 备份/审计/回滚 + 收编 skill_improvement_service 的死文件去向。返工信号注入可作 v1.1（reflection 已有检测，仅缺「关联到具体技能并注入」的接线）。

---

## 5. B 设计：生命周期 curator

### 5.1 状态与存储（brain JSON，零迁移）
每员工一份 `<brain>/skill_lifecycle.json`：
```json
{
  "skills": {
    "<skill_name>": { "status": "active|stale|archived", "pinned": false,
                       "archived_at": "<iso>|null" }
  },
  "updated_at": "<iso>"
}
```
- `last_used` **不入文件**，运行时派生——单一真相、不重复维护。**来源须两路取 max（评审补正）**：
  - `TaskExecutionLog`（该员工 + skill_id，max created_at）——但 ⚠️ `TaskExecutionLog.skill_id` **只等于派单时为子任务选定的那一个技能**，不含 prerouter 软提示 / agent 自行 read 的技能；
  - `SkillRating.created_at`（每次技能调用评分都写，覆盖更全）作**补充信号**；
  - 取两者 max。**键映射（评审补正）**：lifecycle.json 以 `skill_name` 为键，而上述表用数字 `skill_id`（负=本地 localId，正=远程 id），二者经 `employee_skills`（同时有 `skill_id` 与 `skill_name`，[models/employee_skill.py](../../apps/server/src/models/employee_skill.py)）映射；技能 fork/改名后以当前 employee_skills 绑定为准。
  - **保守口径**：任一信号显示近期用过即判 active；只有所有信号都 idle 才老化——宁可不归档，不可误archive 常用技能。
- `pinned`、`status`、`archived_at` 入文件（curator 与用户操作可写）。

### 5.2 老化状态机（保守）
curator 后台 pass（搭 librarian 既有异步复盘，不占用户主流程）对每个技能：
- `last_used` 距今 **<30 天** → `active`
- **30–90 天** → `stale`（仅标记，行为不变）
- **>90 天** → `archived`
- **绝不删除**；`pinned=true` **豁免**（永不 stale/archived）；archived 可一键恢复→active。
- 从未使用过的技能：以「分配时间」为 last_used 基准，避免新分配立即判 stale。

### 5.3 archived 的行为
- **路由排除**：archived 技能从员工「可用技能集」剔除。⚠️ **排除点（评审补正）**：发生在 `available_skills` 的**构造层**（员工技能清单生成处，[employee.py:76](../../apps/server/src/service/agent/employee.py#L76) 一带），**不是** `skill_prerouter` 内部（它只认一张硬编码 builtin 触发表 `SKILL_TRIGGERS`）。剔除后既不进 prerouter 候选、也不进系统提示技能清单。
- **不删文件/不解绑**：employee_skills 行与副本保留，仅「逻辑隐藏」。
- **UI**：成长面板/技能列表把 archived 折叠到「已归档」分组，提供「恢复」「置顶(pin)」操作。

### 5.4 近重复候选合并
curator pass 顺带扫 `<brain>/skill_candidates/*.md`：
- 按 slug 近似度（如归一化后 token Jaccard / 编辑距离阈值）聚类近重复候选；
- 合并为一条（保留信息最全者，其余并入「亦见」），治 #2 残留的「近义 slug 多候选」。
- 仅合并候选，**不碰已采纳的正式技能**。

### 5.5 员工生命周期（只建议，不自动）
某员工 90 天未被派活 → curator 产出一条**给用户的归档建议**（成长面板/通知），列出闲置专才；**不自动归档**（员工归档牵动总管路由，保守）。用户确认才走既有员工归档/停用路径。

---

## 6. 错误处理
- `update_skill`：name 非已加载 / fork 失败 / 超大小限制 / 库写失败 → 返回明确错误给 agent（不静默），不部分写入（备份在写库前、写库失败则不 sync）。
- `sync_local_skill_to_assignees` 对部分员工失败 → 记日志、不回滚已成功者（与现有行为一致），审计事件标注。
- curator pass：单技能/单候选处理异常 → 跳过该项、继续其余（容错），整体 best-effort。
- `skill_lifecycle.json` 损坏/缺失 → 当作空、重建（不抛）。

---

## 7. 测试计划（TDD，红→绿）
**A**
- update_skill 守卫：改未加载技能被拒；改已加载技能成功。
- fork-on-edit：远程直分配技能首次修订→工作区生成可编辑副本并写入。
- 版本备份：改前 `.history/<ts>.md` 落盘；回滚端点还原。
- 落库+同步：update_local_skill 被调用、sync 推送到多个 assignee（mock 验证调用）。
- 审计事件写入。
- skill_improvement_service 不再写死文件、改为注入/待办（断言新去向）。

**B**
- 状态机：<30/30-90/>90 天分别 active/stale/archived；pinned 豁免；从未使用按分配时间。
- last_used 从 TaskExecutionLog 派生正确。
- archived 从 available_skills 剔除（prerouter 上游）。
- 恢复：archived→active。
- 近重复候选合并：近义 slug 聚类为一；不动正式技能。
- lifecycle.json 损坏→重建不抛。

**前端**：成长面板「修订建议/审计事件」展示、archived 折叠+恢复+pin、回滚入口——`tsc --noEmit` + 人工验收（沿用本季前端测试口径）。

---

## 8. 风险与开放问题
1. **A 直接改无审核门**（用户已拍）：靠备份+审计+回滚+加载守卫兜底；开放：要不要给「改他人高频技能」配轻量确认档（默认不配）。
2. **全员同步阻塞**：`sync_local_skill_to_assignees` 同步多员工，员工多时是否需异步化（v1 同步，量大再说）。
3. **last_used 精度（前置项，B-1 开工前必核）**：`TaskExecutionLog.skill_id` 只记**派单技能**，prerouter 软提示 / agent 自行 read 的技能、以及非任务态直接对话用技能都**不落 log**。已在 §5.1 用「TaskExecutionLog ∪ SkillRating 取 max + 保守口径」缓解；规划时仍须核实 SkillRating 的实际写入覆盖率，若两路都漏某类使用，则该类技能老化判定偏保守（不归档）即可，绝不可误归档常用技能。
4. **B 与 A 交互**：archived 技能被 A 的低分/返工信号触发时，应先「恢复」还是忽略——v1 忽略 archived 的自动信号。

---

## 9. 分解与节奏
**先 A 后 B**（A 是主线、价值最高；B 的候选合并依赖候选模型理顺）。
- **A-1**：`update_skill` 工具 + fork-on-edit + 落库同步 + 加载守卫（核心闭环）。
- **A-2**：版本备份 + 回滚端点/UI + 审计事件展示。
- **A-3**：收编 skill_improvement_service 死文件去向 + 提示词引导。
- **B-1**：`skill_lifecycle.json` + 老化状态机 + last_used 派生（curator pass）。
- **B-2**：archived 路由排除 + UI 折叠/恢复/pin。
- **B-3**：近重复候选合并 + 员工归档建议。

每阶段 TDD + 关键处独立 code-review 子代理。
