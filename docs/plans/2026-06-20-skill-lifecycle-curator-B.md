# 生命周期 curator (B) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给技能/候选做保守的闲置老化（active→stale→archived，绝不删、可恢复、pinned 豁免）+ 近重复候选合并 + 员工建议归档，治「只增不减」的膨胀。

**Architecture:** 新增 `learning/curator.py`，搭 librarian 既有后台 pass（`run_librarian` 加第 4 步 `run_curator`）。状态存 `<brain>/skill_lifecycle.json`（零 DB 迁移）；`last_used` 运行时从 `TaskExecutionLog ∪ SkillRating` 取 max、以 `employee_skills.created_at`（分配时间）为基线。archived 在 `employee.py` 的 `available_skills` 构造层逻辑隐藏（不删文件）。

**Tech Stack:** Python 3.11 / SQLAlchemy / FastAPI / pytest（`cd apps/server && uv run pytest`）；前端 React/TS（`pnpm --filter web typecheck`）。

> 来源 spec：[../specs/2026-06-20-skill-self-improvement-and-lifecycle-curator-design.md](../specs/2026-06-20-skill-self-improvement-and-lifecycle-curator-design.md) §5。A（技能在用中自改进）已落地，见 [skill-self-improvement-A.md](2026-06-20-skill-self-improvement-A.md)。

---

## 文件结构

| 文件 | 责任 | 动作 |
|------|------|------|
| `apps/server/src/service/learning/curator.py` | 生命周期 curator：lifecycle.json 读写 + last_used 计算 + 老化状态机 + 近重复候选合并 + 员工归档建议 | 新建 |
| `apps/server/src/service/learning/librarian.py` | `run_librarian` 加第 4 步 `run_curator` | 改（`run_librarian` ~L? 见下） |
| `apps/server/src/service/agent/employee.py` | archived 技能从 `available_skills` 剔除 | 改（L82 一带） |
| `apps/server/src/service/employee_service.py` | 成长面板 payload 暴露每技能 lifecycle 状态 + 员工归档建议；restore/pin 服务方法 | 改（`build_employee_growth_brain` ~L1450） |
| `apps/server/src/api/employee_api.py`（或 skill_api.py） | restore / pin 技能、忽略员工归档建议 端点 | 改 |
| `apps/web/src/api/employee.ts` + `growth-brain-section.tsx` | archived 折叠分组 + 恢复/置顶按钮 + 员工归档建议 | 改 |
| `apps/server/tests/test_skill_lifecycle_curator.py` | B-1~B-4 单测 | 新建 |

> **关键事实（已核实）**：
> - 后台入口 `run_librarian(employee_id)`：依次 `generate_profile → consolidate_memory → promote_skills`（[librarian.py](../../apps/server/src/service/learning/librarian.py) `run_librarian`），curator 加为第 4 步。`_brain_root_for(employee_id)` 给 brain 根。
> - `TaskExecutionLog`：`employee_id`、`skill_id`(可空 int)、`created_at`/`started_at`/`ended_at`（[models/task_execution_log.py](../../apps/server/src/models/task_execution_log.py)）。`skill_id` 只记**派单技能**。
> - `SkillRating`：`employee_id`、`skill_id`、`created_at`（[models/skill_rating.py](../../apps/server/src/models/skill_rating.py)）——补充使用信号。
> - `EmployeeSkill`：`skill_id`、`skill_name`、`created_at`(分配时间)（[models/employee_skill.py](../../apps/server/src/models/employee_skill.py)）——name↔id 映射 + last_used 基线。
> - `available_skills = list_available_skills(skills_root)` 在 [employee.py:82](../../apps/server/src/service/agent/employee.py#L82)，archived 排除在此 caller 层（有 employee_id），非 `list_available_skills` 内部。

### lifecycle.json schema
```json
{
  "skills": {
    "<skill_name>": {
      "status": "active|stale|archived",
      "pinned": false,
      "archived_at": "<iso>|null",
      "restored_at": "<iso>|null"
    }
  },
  "updated_at": "<iso>"
}
```
- `status` 每次 curator 运行**从 last_used 重算**（pinned 除外）；`pinned`/`restored_at` 是用户操作写入、curator 不覆盖。
- `last_used = max(分配时间, max(TaskExecutionLog.created_at), max(SkillRating.created_at), restored_at)`。
- 阈值常量：`_STALE_DAYS = 30`、`_ARCHIVED_DAYS = 90`。

---

## Task 1：lifecycle 存储 + last_used 计算（B-1 纯函数）

**Files:**
- Create: `apps/server/src/service/learning/curator.py`
- Test: `apps/server/tests/test_skill_lifecycle_curator.py`

- [ ] **Step 1: 失败测试——lifecycle.json 读写往返 + 损坏容错**

```python
# apps/server/tests/test_skill_lifecycle_curator.py
from src.service.learning import curator


def test_lifecycle_roundtrip_and_corrupt_tolerant(tmp_path):
    brain = tmp_path
    curator._save_lifecycle(brain, {"skills": {"pptx": {"status": "active", "pinned": True,
                                                        "archived_at": None, "restored_at": None}}})
    loaded = curator._load_lifecycle(brain)
    assert loaded["skills"]["pptx"]["pinned"] is True
    # 损坏文件 → 当空，不抛
    (brain / "skill_lifecycle.json").write_text("{ broken", encoding="utf-8")
    assert curator._load_lifecycle(brain) == {"skills": {}}
```

- [ ] **Step 2: 跑测试确认失败** — `cd apps/server && uv run pytest tests/test_skill_lifecycle_curator.py::test_lifecycle_roundtrip_and_corrupt_tolerant -v`（FAIL：模块不存在）

- [ ] **Step 3: 实现 curator.py 的存储层**

```python
# apps/server/src/service/learning/curator.py
"""技能/候选/员工 生命周期 curator：保守闲置老化，绝不删除。搭 librarian 后台 pass。"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

_LIFECYCLE_FILE = "skill_lifecycle.json"
_STALE_DAYS = 30
_ARCHIVED_DAYS = 90


def _load_lifecycle(brain: Path) -> dict:
    """读 <brain>/skill_lifecycle.json；缺失/损坏 → {"skills": {}}（容错不抛）。"""
    fp = brain / _LIFECYCLE_FILE
    try:
        if not fp.is_file():
            return {"skills": {}}
        data = json.loads(fp.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("skills"), dict):
            return {"skills": {}}
        return data
    except (OSError, json.JSONDecodeError):
        return {"skills": {}}


def _save_lifecycle(brain: Path, data: dict) -> None:
    """best-effort 写回（含 updated_at）。"""
    try:
        brain.mkdir(parents=True, exist_ok=True)
        data = dict(data)
        data["updated_at"] = datetime.now().isoformat(timespec="seconds")
        (brain / _LIFECYCLE_FILE).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        logger.warning("save lifecycle failed", exc_info=True)
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 失败测试——last_used 取四源 max（分配时间为基线）**

```python
def test_compute_last_used_takes_max_of_sources():
    from datetime import datetime
    # 纯函数版本：传入各源时间，断言取 max；None 源跳过
    assign = datetime(2026, 1, 1)
    task = datetime(2026, 3, 1)
    rating = datetime(2026, 2, 1)
    restored = None
    assert curator._effective_last_used(assign, task, rating, restored) == task
    # 从未使用：只有分配时间
    assert curator._effective_last_used(assign, None, None, None) == assign
```

- [ ] **Step 6-7: 实现 `_effective_last_used(assign, task_max, rating_max, restored) -> datetime`**（忽略 None，取 max；assign 必非空作基线）→ 跑测试通过。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/service/learning/curator.py apps/server/tests/test_skill_lifecycle_curator.py
git commit -m "feat(curator): lifecycle.json 存储 + last_used 四源取 max (B-1)"
```

---

## Task 2：老化状态机 + run_curator 编排 + 挂 librarian（B-1）

**Files:**
- Modify: `apps/server/src/service/learning/curator.py`（`_age_status` + `run_curator`）
- Modify: `apps/server/src/service/learning/librarian.py`（`run_librarian` 加第 4 步）

- [ ] **Step 1: 失败测试——状态机 active/stale/archived + pinned 豁免**

```python
from datetime import datetime, timedelta

def test_age_status_thresholds():
    now = datetime(2026, 6, 1)
    assert curator._age_status(now - timedelta(days=5), now, pinned=False)[0] == "active"
    assert curator._age_status(now - timedelta(days=45), now, pinned=False)[0] == "stale"
    assert curator._age_status(now - timedelta(days=120), now, pinned=False)[0] == "archived"
    # pinned 永远 active，即便闲置很久
    assert curator._age_status(now - timedelta(days=999), now, pinned=True)[0] == "active"
```

- [ ] **Step 2-4:** 实现 `_age_status(last_used, now, *, pinned) -> tuple[str, str|None]` 返回 `(status, archived_at_iso_or_None)`：pinned→active；否则按 30/90 天阈值；archived 时返回 archived_at=now.iso（非 archived 返回 None）→ 跑测试通过。

- [ ] **Step 5: 失败测试——run_curator 用真 DB + brain，把闲置技能标 archived、近期用过的标 active**

```python
def test_run_curator_ages_skills(tmp_path, monkeypatch, db_session):
    # 安排：员工有两个技能 A(120天前分配且无使用)、B(今天用过)
    # 行动：curator.run_curator(employee_id)
    # 断言：lifecycle.json 中 A.status=="archived"、B.status=="active"
    ...
```
> 用现有测试的 DB fixture（grep tests/ 找 `db_session`/in-memory session 的范式）；造 `EmployeeSkill`(created_at 120 天前) + 一条 `TaskExecutionLog`(今天, skill_id=B)。monkeypatch `_brain_root_for`→tmp_path。

- [ ] **Step 6: 实现 `run_curator(employee_id)`**：开 session（仿 librarian 其它函数）；读该员工 `EmployeeSkill` 行（skill_id↔skill_name + created_at 基线）；对每个技能查 `max(TaskExecutionLog.created_at)`、`max(SkillRating.created_at)`（按 employee_id+skill_id）；读 lifecycle.json 取 pinned/restored_at；算 `_effective_last_used` → `_age_status` → 写回 lifecycle.json。全程容错（异常只 warning，不阻断 librarian）。

- [ ] **Step 7: 挂进 librarian**：在 `run_librarian`（librarian.py）的 `promote_skills(employee_id)` 之后加：
```python
        from src.service.learning.curator import run_curator
        run_curator(employee_id)
```
（放 try 内，沿用其容错。）

- [ ] **Step 8: 跑测试 + Commit**

```bash
git commit -am "feat(curator): 老化状态机 + run_curator + 挂 librarian 后台 (B-1)"
```

---

## Task 3：archived 技能从 available_skills 剔除（B-2 路由效果）

**Files:**
- Modify: `apps/server/src/service/agent/employee.py`（L82 一带）

- [ ] **Step 1: 失败测试——archived 技能不进 available_skills**

在 `tests/test_skill_lifecycle_curator.py` 加：构造一个辅助 `curator.archived_skill_names(brain) -> set[str]`（读 lifecycle.json 取 status=="archived" 的名字），断言其正确返回 archived 名单。employee.py 的过滤用它。

```python
def test_archived_skill_names(tmp_path):
    curator._save_lifecycle(tmp_path, {"skills": {
        "a": {"status": "archived"}, "b": {"status": "active"}}})
    assert curator.archived_skill_names(tmp_path) == {"a"}
```

- [ ] **Step 2-4:** 实现 `curator.archived_skill_names(brain) -> set[str]`（容错→空集）→ 跑测试通过。

- [ ] **Step 5: 在 employee.py 过滤**：`available_skills = list_available_skills(skills_root)` 之后（[employee.py:82](../../apps/server/src/service/agent/employee.py#L82)），当 `employee_id is not None` 时剔除 archived（best-effort try/except）：
```python
    if employee_id is not None:
        try:
            from src.service.learning.curator import archived_skill_names
            from src.service.learning.librarian import _brain_root_for
            _archived = archived_skill_names(_brain_root_for(employee_id))
            available_skills = [s for s in available_skills if s not in _archived]
        except Exception:  # noqa: BLE001
            pass
```
> 须在 `_augment_skills_with_skill_creator`（L173）**之前**剔除，且 skill-creator 不应被 archive（它是运行时注入的，不在 employee_skills 里，curator 不会碰它）。确认过滤位置不破坏 augment。

- [ ] **Step 6: 跑相关测试**：`uv run pytest tests/ -k "skill_lifecycle or update_skill" -v`（确保 employee.py 仍 import 干净）+ `uv run python -c "import src.service.agent.employee"`。

- [ ] **Step 7: 独立 code-review** 审：过滤时机（在 augment 前、不误伤 skill-creator）、best-effort 不破坏建 agent。

- [ ] **Step 8: Commit** `git commit -am "feat(curator): archived 技能从 available_skills 逻辑隐藏 (B-2)"`

---

## Task 4：restore/pin 端点 + 成长面板 payload 暴露 lifecycle（B-2）

**Files:**
- Modify: `apps/server/src/service/learning/curator.py`（`set_pinned` / `restore_skill` 服务函数）
- Modify: `apps/server/src/service/employee_service.py`（`build_employee_growth_brain` 加 `skill_lifecycle`）
- Modify: `apps/server/src/api/employee_api.py`（端点）

- [ ] **Step 1: 失败测试——restore 把 archived 改 active 并写 restored_at；pin 写 pinned**

```python
def test_restore_and_pin(tmp_path):
    curator._save_lifecycle(tmp_path, {"skills": {"a": {"status": "archived", "pinned": False,
                                                        "archived_at": "x", "restored_at": None}}})
    curator.restore_skill(tmp_path, "a")
    lc = curator._load_lifecycle(tmp_path)["skills"]["a"]
    assert lc["status"] == "active" and lc["restored_at"]   # restored_at 置为现在
    curator.set_pinned(tmp_path, "a", True)
    assert curator._load_lifecycle(tmp_path)["skills"]["a"]["pinned"] is True
```

- [ ] **Step 2-4:** 实现 `restore_skill(brain, name)`（status→active、restored_at=now、archived_at=None）与 `set_pinned(brain, name, pinned)`（写 pinned；技能不在表里则创建条目）→ 跑测试通过。

- [ ] **Step 5: payload 暴露**：在 `build_employee_growth_brain`（[employee_service.py](../../apps/server/src/service/employee_service.py) ~L1450，A 已在此加过 `recent_skill_edits`）追加 `skill_lifecycle`：读该员工 brain 的 lifecycle.json，返回 `{skill_name: {status, pinned}}`（best-effort，缺失→{}）。同步 schema `EmployeeGrowthBrainRead`。

- [ ] **Step 6: 端点**：在 employee_api.py 加 `POST /employees/{id}/growth/skills/{skill_name}/restore` 与 `.../pin`（body `{pinned: bool}`）。解析 brain：`_brain_root_for(id)`；skill_name 防穿越（沿用 A 的 `_VERSION_RE` 思路或复用既有 skill name 校验 `_validate_skill_slug`/`_normalize_skill_name`）。写端点测试（TestClient，仿 A 的 restore 端点测试）。

- [ ] **Step 7: 独立 code-review**（端点鉴权/路径穿越/容错）+ **Commit** `git commit -am "feat(curator): restore/pin 端点 + 成长面板暴露 lifecycle (B-2)"`

---

## Task 5：近重复候选合并（B-3）

**Files:**
- Modify: `apps/server/src/service/learning/curator.py`（`_merge_near_dup_candidates`）

- [ ] **Step 1: 失败测试——近义 slug 候选合并为一**

```python
def test_merge_near_dup_candidates(tmp_path):
    cand = tmp_path / "skill_candidates"
    cand.mkdir()
    (cand / "excel-export.md").write_text("---\nname: excel-export\n---\nA", encoding="utf-8")
    (cand / "export-excel.md").write_text("---\nname: export-excel\n---\nB", encoding="utf-8")
    (cand / "pdf-merge.md").write_text("---\nname: pdf-merge\n---\nC", encoding="utf-8")
    curator._merge_near_dup_candidates(tmp_path)
    remaining = sorted(p.name for p in cand.glob("*.md"))
    # 两个 excel 近义合并为一，pdf-merge 保留 → 共 2 个
    assert len(remaining) == 2 and "pdf-merge.md" in remaining
```

- [ ] **Step 2-4:** 实现 `_merge_near_dup_candidates(brain)`：扫 `skill_candidates/*.md`；用 `difflib.SequenceMatcher(None, a, b).ratio()` 对 slug（或归一化排序 token）两两比，> 0.8 聚为一类（**保守阈值**，宁可不合并）；每类保留**信息最全者**（正文最长），其余在保留者末尾追加「亦见: <name>」后删除。仅动候选、**绝不碰** `skills/`（正式技能）。容错。

- [ ] **Step 5: 挂进 run_curator**：在 `run_curator` 末尾调 `_merge_near_dup_candidates(brain)`（同一后台 pass）。补一条「run_curator 后近重复候选被合并」的集成断言。

- [ ] **Step 6: 独立 code-review**（合并阈值是否过激、是否可能误并不同技能）+ **Commit** `git commit -am "feat(curator): 近重复技能候选合并 (B-3)"`

---

## Task 6：员工归档建议（B-4，只建议不自动）

**Files:**
- Modify: `apps/server/src/service/learning/curator.py`（`employee_archive_suggestion`）
- Modify: `apps/server/src/service/employee_service.py`（payload 或独立查询暴露）

- [ ] **Step 1: 失败测试——90 天没派活的员工产出归档建议**

```python
def test_employee_archive_suggestion(db_session):
    # 员工最后一条 TaskExecutionLog 在 100 天前 → suggestion 为 True/含该员工
    # 30 天内有活 → 不建议
    ...
```

- [ ] **Step 2-4:** 实现 `employee_archive_suggestion(db, employee_id) -> dict|None`：查该员工 `max(TaskExecutionLog.created_at)`；> 90 天（或从无记录且创建 > 90 天）→ 返回 `{employee_id, last_active, idle_days}`，否则 None。**不自动归档**——仅返回建议数据。

- [ ] **Step 5: 暴露**：在 `build_employee_growth_brain` payload 加 `archive_suggestion`（None 或上述 dict）。同步 schema。

- [ ] **Step 6: Commit** `git commit -am "feat(curator): 员工闲置归档建议(只提示不自动) (B-4)"`

---

## Task 7：前端——archived 折叠 + 恢复/置顶 + 员工归档建议（B-5）

**Files:**
- Modify: `apps/web/src/api/employee.ts`（类型 + restore/pin API）
- Modify: `apps/web/src/components/chat/contacts/growth-brain-section.tsx`

- [ ] **Step 1: 类型**：`EmployeeGrowthBrain` 加 `skill_lifecycle?: Record<string, {status: string; pinned: boolean}>` 与 `archive_suggestion?: {...} | null`；加 `restoreSkill(employeeId, name)` / `pinSkill(employeeId, name, pinned)` API 函数（仿现有 adopt/dismiss 候选 API）。
- [ ] **Step 2: 技能区分组**：在「技能」Card 里，按 `skill_lifecycle[name].status` 把 archived 折到「已归档」分组（默认折叠），每条给「恢复」「置顶(pin)」按钮（pinned 的标星）。stale 可加灰标但不折叠。
- [ ] **Step 3: 员工归档建议**：若 `archive_suggestion` 非空，顶部一条提示「该员工已闲置 N 天，考虑归档？」（仅提示 + 跳转既有员工停用入口，不在此自动归档）。
- [ ] **Step 4: 类型检查**：`pnpm --filter web typecheck`（净；既有无关报错忽略）。
- [ ] **Step 5: Commit** `git commit -am "feat(curator): 成长面板 archived 折叠+恢复/置顶+员工归档建议 (B-5)"`

---

## 收尾验证
- [ ] 全量后端：`cd apps/server && uv run pytest -q`，0 failed。
- [ ] 人工冒烟：① 造一个 120 天前分配、无使用的技能 → 跑 librarian → lifecycle.json 标 archived → 该技能不再进员工 available_skills；② 成长面板「已归档」分组出现，点恢复→回 active、点置顶→pinned 后不再被 archive；③ 两个近义候选经 curator 合并为一；④ 闲置员工出归档建议。
- [ ] 更新 [learning-loop-self-evolution.md](../learning-loop-self-evolution.md)：补「生命周期 curator」一节（与 §7.5 并列，治膨胀）。
- [ ] 更新 [reference-hermes-agent-learnings.md](../reference-hermes-agent-learnings.md) §五：标 B 已落地。
- [ ] 更新 [orchestrator-architecture.md](../orchestrator-architecture.md)：大脑布局补 `skill_lifecycle.json`；学习闭环补 curator。

## 风险与回归（实现时盯）
- **last_used 偏保守是刻意的**：TaskExecutionLog.skill_id 只记派单技能，prerouter/自读用的技能不落 log → 这类技能可能被误判闲置。已用「分配时间为基线 + SkillRating 补充 + 30/90 天宽阈值」缓解；宁可不归档，不可误archive 常用技能。archived 只逻辑隐藏（文件在、可恢复、可 pin），即便误判代价可控。
- **curator 每次 librarian pass 都跑**：均为本地文件 + 该员工少量行查询，开销小；与 5min 限流同受 `run_librarian` 锁约束。
- **近重复合并阈值**（0.8）宁高勿低，防误并不同技能；只动候选不碰正式技能。
- **绝不自动归档员工**：B-4 仅产建议数据，归档动作仍由用户经既有路径触发。
