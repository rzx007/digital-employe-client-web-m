# 技能在用中自改进 (A) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给员工 agent 一个 `update_skill` 工具，干活时发现技能错/缺/过时即就地改 → 写技能库文件 → 同步所有已分配员工，改前自动备份、可回滚、留审计。

**Architecture:** 新增 `update_skill_tool.py` 工厂，挂进 `employee.get_agent` 的 `extra_tools`。落库走既有 `LocalSkillService.update_local_skill(target="workspace")`（有工作区副本用之，否则 fork 内置，绝不就地改全局内置）+ `EmployeeService.sync_local_skill_to_assignees` 全员同步。远程直分配技能（库里无文件）补一条 fork-on-edit。收编现有 `skill_improvement_service` 死文件去向。

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy / LangChain `@tool` / deepagents；pytest（`cd apps/server && uv run pytest`）。

> 来源 spec：[../specs/2026-06-20-skill-self-improvement-and-lifecycle-curator-design.md](../specs/2026-06-20-skill-self-improvement-and-lifecycle-curator-design.md) §4。B（生命周期 curator）另立计划。

---

## 文件结构

| 文件 | 责任 | 动作 |
|------|------|------|
| `apps/server/src/service/agent/update_skill_tool.py` | `create_update_skill_tool` 工厂 + 落库同步逻辑 | 新建 |
| `apps/server/src/service/agent/employee.py` | 在 `get_agent` 挂载 update_skill 工具 + 提示词引导 | 改（L228、L272 一带） |
| `apps/server/src/service/local_skill_service.py` | 远程直分配技能 fork-on-edit 助手 + 改前备份/回滚 | 改 |
| `apps/server/src/api/skill_api.py` | 技能版本回滚端点 | 改 |
| `apps/server/src/service/skill_improvement_service.py` | 死文件 → 注入提示去向 | 改 |
| `apps/server/tests/test_update_skill_tool.py` | A-1/A-1.4/A-2 单测 | 新建 |
| `apps/server/tests/test_skill_improvement_redirect.py` | A-3 单测 | 新建 |

> 关键签名（已核实，照抄勿改）：
> - `LocalSkillService.update_local_skill(skill_name, workspace_id, *, display_name_zh=None, skill_md_content=None, target=None)` — **必须传 `target="workspace"`**，否则仅有内置版时会就地改全局内置（[local_skill_service.py:797](../../apps/server/src/service/local_skill_service.py#L797)）。
> - `EmployeeService.sync_local_skill_to_assignees(db, *, user_id, workspace_id, skill_name)`（[employee_service.py:1072](../../apps/server/src/service/employee_service.py#L1072)）。
> - `get_agent` 闭包有 `employee_id`、`workspace_id`（可能 None），无 `db`/`user_id` → 工具内自开 session（仿 [employee.py:254](../../apps/server/src/service/agent/employee.py#L254) `get_session_local()()`）从 `Employee` 反查 `workspace_id`+`user_id`。

---

## Task 1：update_skill 工具核心（A-1，本地/内置技能）

**Files:**
- Create: `apps/server/src/service/agent/update_skill_tool.py`
- Test: `apps/server/tests/test_update_skill_tool.py`

- [ ] **Step 1: 写失败测试——守卫拒绝未加载技能**

```python
# apps/server/tests/test_update_skill_tool.py
from src.service.agent.update_skill_tool import create_update_skill_tool


def test_rejects_skill_not_loaded():
    tool = create_update_skill_tool(employee_id=1, available_skills=["pptx", "xlsx"])
    out = tool.invoke({"skill_name": "not-loaded", "new_content": "x", "reason": "r"})
    assert "拒绝" in out and "not-loaded" in out
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_update_skill_tool.py::test_rejects_skill_not_loaded -v`
Expected: FAIL（模块/函数不存在）

- [ ] **Step 3: 写最小实现**

```python
# apps/server/src/service/agent/update_skill_tool.py
"""员工「在用中自改进」工具：发现已加载技能有错/缺/过时 → 就地改并落技能库+全员同步。"""
from __future__ import annotations

import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def create_update_skill_tool(employee_id: int, available_skills: list[str]):
    """构造绑定到某员工的 update_skill 工具。available_skills 即该员工本轮已加载技能，
    作为「只能改已加载技能」的守卫白名单。"""
    loaded = set(available_skills or [])

    @tool
    def update_skill(skill_name: str, new_content: str, reason: str) -> str:
        """当你加载的某个技能在使用中发现**错误/缺步骤/已过时**，用本工具就地修正它的
        SKILL.md 全文。仅在确有把握、且是技能本身的问题（非本次任务一次性特例）时才改；
        改动会写入技能库并同步给所有使用该技能的同事，故须类级、通用、保守。

        Args:
            skill_name: 要修订的技能名（必须是你已加载的技能之一）。
            new_content: 修订后的完整 SKILL.md 文本（全量替换）。
            reason: 为何修订（错在哪/缺什么），将记入审计。
        """
        if skill_name not in loaded:
            return (
                f"拒绝：技能「{skill_name}」不在你已加载的技能列表中，"
                f"只能修订已加载的技能。已加载：{sorted(loaded)}"
            )
        return _apply_skill_update(employee_id, skill_name, new_content, reason)

    return update_skill


def _apply_skill_update(
    employee_id: int, skill_name: str, new_content: str, reason: str
) -> str:
    from src.db.session import get_session_local
    from src.models.employee import Employee
    from src.service.local_skill_service import LocalSkillService
    from src.service.employee_service import EmployeeService

    db = get_session_local()()
    try:
        emp = db.get(Employee, employee_id)
        if emp is None:
            return "拒绝：未找到员工记录。"
        workspace_id = emp.workspace_id
        user_id = emp.user_id

        LocalSkillService.update_local_skill(
            skill_name, workspace_id, skill_md_content=new_content, target="workspace"
        )
        EmployeeService.sync_local_skill_to_assignees(
            db, user_id=user_id, workspace_id=workspace_id, skill_name=skill_name
        )
        db.commit()
        logger.info(
            "update_skill applied: emp=%s skill=%s reason=%s",
            employee_id, skill_name, reason,
        )
        return f"已更新技能「{skill_name}」并同步所有使用该技能的同事。"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("update_skill failed: %s", exc, exc_info=True)
        return f"更新技能「{skill_name}」失败：{exc}"
    finally:
        db.close()
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_update_skill_tool.py::test_rejects_skill_not_loaded -v`
Expected: PASS

- [ ] **Step 5: 写落库+同步成功路径测试（mock 下游）**

```python
def test_applies_update_and_syncs(monkeypatch):
    calls = {}

    class _Emp:
        workspace_id = 7
        user_id = "u1"

    class _DB:
        def get(self, *_): return _Emp()
        def commit(self): calls["commit"] = True
        def rollback(self): calls["rollback"] = True
        def close(self): calls["close"] = True

    monkeypatch.setattr(
        "src.db.session.get_session_local", lambda: (lambda: _DB())
    )
    monkeypatch.setattr(
        "src.service.local_skill_service.LocalSkillService.update_local_skill",
        lambda name, ws, **kw: calls.setdefault("update", (name, ws, kw)),
    )
    monkeypatch.setattr(
        "src.service.employee_service.EmployeeService.sync_local_skill_to_assignees",
        lambda db, **kw: calls.setdefault("sync", kw),
    )
    tool = create_update_skill_tool(employee_id=1, available_skills=["pptx"])
    out = tool.invoke({"skill_name": "pptx", "new_content": "NEW", "reason": "缺步骤"})

    assert "已更新" in out
    assert calls["update"][0] == "pptx" and calls["update"][1] == 7
    assert calls["update"][2]["skill_md_content"] == "NEW"
    assert calls["update"][2]["target"] == "workspace"   # 防就地改全局内置
    assert calls["sync"] == {"user_id": "u1", "workspace_id": 7, "skill_name": "pptx"}
    assert calls.get("commit") and calls.get("close")
```

- [ ] **Step 6: 跑全文件测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_update_skill_tool.py -v`
Expected: PASS（2 passed）

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/service/agent/update_skill_tool.py apps/server/tests/test_update_skill_tool.py
git commit -m "feat(skill): update_skill 工具核心——守卫+落库+全员同步 (A-1)"
```

---

## Task 2：挂载到员工 agent（A-1 接线）

**Files:**
- Modify: `apps/server/src/service/agent/employee.py`（`extra_tools` 构造处，L228 一带）

- [ ] **Step 1: 写集成测试——get_agent 的工具集含 update_skill**

```python
# 追加到 tests/test_update_skill_tool.py
def test_tool_registered_when_employee_id(monkeypatch, tmp_path):
    # 仅验证「有 employee_id 时工具被纳入」的接线意图：直接断言工厂在 employee 模块被引用
    import src.service.agent.employee as emp_mod
    assert hasattr(emp_mod, "create_update_skill_tool") or True  # 接线见 Step 3
```

> 说明：`get_agent` 起真模型/检查点，端到端难单测；本任务以「工厂被 import 并在 employee_id 非空时 append 到 extra_tools」为验收，靠下一步代码审查 + 人工冒烟确认工具出现在模型可见工具里。

- [ ] **Step 2: 在 employee.py 引入并挂载**

在 import 区加：
```python
from src.service.agent.update_skill_tool import create_update_skill_tool
```
在 `extra_tools` 初始化后（[employee.py:228](../../apps/server/src/service/agent/employee.py#L228) 之后）加：
```python
    # 技能在用中自改进：员工可就地修订已加载技能并落库同步（A）。
    # 需 employee_id 反查 workspace/user；available_skills 作「只能改已加载技能」守卫。
    if employee_id is not None:
        extra_tools.append(
            create_update_skill_tool(employee_id, available_skills)
        )
```

- [ ] **Step 3: 跑测试 + 类型检查**

Run: `cd apps/server && uv run pytest tests/test_update_skill_tool.py -v`
Expected: PASS

- [ ] **Step 4: 独立 code-review 子代理审本任务接线**

派 general-purpose 子代理审：update_skill 工具的挂载时机（available_skills 是否已含 augment 后的全集）、是否泄漏到不该有的路径、target="workspace" 是否真能防就地改全局内置。修订后再继续。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/employee.py apps/server/tests/test_update_skill_tool.py
git commit -m "feat(skill): 员工 agent 挂载 update_skill 工具 (A-1)"
```

---

## Task 3：远程直分配技能的 fork-on-edit（A-1.4）

**背景：** 远程技能「直接分配给员工」时只落到员工私有副本 + DB，**技能库无文件** → `update_local_skill` 走 `_resolve_editable_skill_dir` 找不到（workspace/builtin 皆无）抛 404。需先把员工私有副本固化为工作区本地技能。

**Files:**
- Modify: `apps/server/src/service/local_skill_service.py`（新增 `ensure_editable_from_employee_copy` 助手）
- Modify: `apps/server/src/service/agent/update_skill_tool.py`（落库前调用）

- [ ] **Step 1: 写失败测试——库无文件时从员工副本 fork**

```python
def test_fork_from_employee_copy_when_no_library(monkeypatch, tmp_path):
    from src.service.local_skill_service import LocalSkillService
    # 构造：技能库无该技能；员工私有副本 <skill_path>/<emp>/skills/<name>/SKILL.md 存在
    # 断言：ensure_editable_from_employee_copy 后，工作区库出现可编辑副本
    ...
```

> 实现前先读 `_skill_dir`、`_resolve_local_root`、`EmployeeService._resolve_skill_root`，对齐路径来源；fork 逻辑仿 `_fork_builtin_to_workspace`（[local_skill_service.py:766](../../apps/server/src/service/local_skill_service.py#L766)），源换成员工私有副本目录，并写入新 localId 元数据。

- [ ] **Step 2: 跑测试确认失败** — `uv run pytest tests/test_update_skill_tool.py::test_fork_from_employee_copy_when_no_library -v`

- [ ] **Step 3: 实现 `ensure_editable_from_employee_copy(skill_name, workspace_id, employee_id)`**：库已可编辑→返回；否则若员工私有副本存在→copytree 到工作区库 + 写 localId 元数据→返回；都无→抛清晰错误。

- [ ] **Step 4: update_skill_tool 在 update_local_skill 前调用它**（仅当 update 抛 404 时兜底，或前置探测）。

- [ ] **Step 5: 跑测试确认通过 + Commit**

```bash
git commit -am "feat(skill): 远程直分配技能 fork-on-edit——首次修订固化为本地技能 (A-1.4)"
```

---

## Task 4：改前版本备份 + 回滚端点（A-2）

**Files:**
- Modify: `apps/server/src/service/agent/update_skill_tool.py`（落库前备份）
- Modify: `apps/server/src/api/skill_api.py`（回滚端点）
- Test: `apps/server/tests/test_update_skill_tool.py`

- [ ] **Step 1: 写失败测试——改前 SKILL.md 备份到 .history/**

```python
def test_backs_up_before_overwrite(monkeypatch, tmp_path):
    # 安排：可编辑技能目录含旧 SKILL.md
    # 行动：_apply_skill_update
    # 断言：<skill_dir>/.history/<ts>.md 含旧内容；SKILL.md 为新内容
    ...
```

- [ ] **Step 2-4:** 在 `_apply_skill_update` 里、`update_local_skill` 调用**前**：解析可编辑目录（复用 `_resolve_editable_skill_dir` / fork 后路径），读旧 `SKILL.md`，写 `<skill_dir>/.history/<YYYYmmdd-HHMMSS>.md`（`datetime.now()`，Python 运行时可用）。失败不阻断主流程（best-effort + 日志）。跑测试转绿。

- [ ] **Step 5: 回滚端点**：`POST /skills/local/{skill_name}/restore`，body `{version: "<ts>"}` → 读 `.history/<ts>.md` → `update_local_skill(target="workspace")` 写回 + `sync_local_skill_to_assignees`。复用 Task 1 落库链路。写端点测试。

- [ ] **Step 6: 独立 code-review** 审备份/回滚的路径解析与并发覆盖安全。

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(skill): update_skill 改前版本备份 + 回滚端点 (A-2)"
```

---

## Task 5：审计事件（A-2）

**Files:**
- Modify: `apps/server/src/service/agent/update_skill_tool.py`

- [ ] **Step 1: 定位事件落点**：先 grep 现有学习闭环/时间线事件写入（journal / reflection 事件 / 成长面板数据源），确定 update_skill 审计该写哪（员工、技能、reason、旧/新内容 hash、时间）。**这一步是调查步骤**，找不到现成 sink 则落到员工 brain 下 `skill_edit_audit.jsonl`（与 `skill_candidates/` 同级，[employee_service.py:36](../../apps/server/src/service/employee_service.py#L36) `_growth_brain_root_for`）。
- [ ] **Step 2-4:** 写测试（审计条目落盘且字段完整）→ 实现 → 转绿。
- [ ] **Step 5: Commit** `git commit -am "feat(skill): update_skill 审计事件——谁改了哪个技能可见 (A-2)"`

---

## Task 6：提示词引导（A-3）

**Files:**
- Modify: `apps/server/src/service/agent/prompts.py`（`build_system_prompt` 的技能段）

- [ ] **Step 1:** 在技能段补一段（spec §4.3 原文）：「你加载的技能若在使用中发现错误/缺步骤/已过时，可用 `update_skill` 就地修正——优先修你正用着的这个技能…须类级、通用、保守，不写 session 专属内容。」
- [ ] **Step 2:** 若 `prompts.py` 有相关单测/快照断言则同步更新；否则 `uv run pytest tests/ -k prompt -v` 确认不破现有断言。
- [ ] **Step 3: Commit** `git commit -am "feat(skill): 员工提示词引导就地修订技能 (A-3)"`

---

## Task 7：收编 skill_improvement_service 死文件去向（A-3）

**背景：** 现状低分(<3)+评论 → 写 `improvement-suggestion.md` 到**会被冲掉的员工副本目录**、无人看（[skill_improvement_service.py:61](../../apps/server/src/service/skill_improvement_service.py#L61)）。改为：分析结果落到**持久且会被读到**的位置，作为下次加载该技能时的提示线索（或审计待办），引导 agent 评估 update_skill。

**Files:**
- Modify: `apps/server/src/service/skill_improvement_service.py`
- Test: `apps/server/tests/test_skill_improvement_redirect.py`

- [ ] **Step 1: 写失败测试——产物不再写易失副本目录**

```python
def test_improvement_not_written_to_volatile_copy(monkeypatch, tmp_path):
    # 断言：trigger_improvement_review 不再在 <skill_path>/<emp>/skills/<name>/ 写 improvement-suggestion.md
    # 而是落到 brain 持久位置 / 注入提示来源
    ...
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 改 `trigger_improvement_review`**：产物写到 brain 持久位置（如 `<brain>/skill_hints/<skill_name>.md`），并在员工系统提示技能段注入「该技能有改进线索，必要时用 update_skill 修订」。
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 独立 code-review** 审：是否仍保留低分→分析的价值、注入是否污染缓存前缀（须落可变段，勿进稳定前缀）。
- [ ] **Step 6: Commit** `git commit -am "feat(skill): 收编 skill_improvement 死文件→持久线索引导 update_skill (A-3)"`

---

## 收尾验证

- [ ] 全量后端测试：`cd apps/server && uv run pytest -q`，0 failed。
- [ ] 人工冒烟：起一个员工，确认 update_skill 出现在工具里；改一个本地技能 → 库文件已变 + 另一持有该技能的员工副本已同步；改内置技能 → 工作区出现 fork、全局内置未变；改前 `.history/` 有备份、回滚可还原。
- [ ] 更新 [learning-loop-self-evolution.md](../learning-loop-self-evolution.md)：补「技能在用中自改进」一节。
- [ ] 更新 [reference-hermes-agent-learnings.md](../reference-hermes-agent-learnings.md) §五：标 A 已落地。

## 风险与回归（实现时盯）
- `target="workspace"` 必须始终传——漏传会就地改全局内置，影响所有工作区（Task 1 Step 5 已断言）。
- `sync_local_skill_to_assignees` 多员工同步是同步调用；员工多时可能慢，v1 接受（spec §8.2）。
- 直接改无审核门：靠 Task 4 备份/回滚 + Task 5 审计兜底（用户已拍）。
