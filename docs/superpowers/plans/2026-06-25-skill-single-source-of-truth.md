# 技能单一真相重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让员工私有技能副本 `<skill_path>/<员工id>/skills/` 成为该员工技能的唯一真相，`EmployeeSkill` DB 行降为磁盘的单向派生投影，消除档案↔履历分叉、采纳不可见、分配 rmtree 冲掉成长技能三个 bug；并把员工自改进（update_skill）改为按员工隔离。

**Architecture:** 磁盘私有副本 = 唯一真相。来源标记复用各技能文件夹内已有的 `.skill-meta.json`（新增 `origin` / `skillId` / `locallyModified` 键）。新增幂等投影函数 `reconcile_employee_skills(db, employee)`：扫磁盘 → 让 EmployeeSkill 行与磁盘集合一致，字段从 meta + SKILL.md 读出。所有改动磁盘技能集的操作末尾调它。分配从 rmtree 全量覆盖改增量（只增删 `assigned:*`、绝不碰 `grown:*`）。update_skill 只改私有副本、不回写库、不广播。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / pytest；`apps/server`。所有命令在 `apps/server` 目录下用 `uv run pytest` 跑。

**Spec:** `docs/superpowers/specs/2026-06-25-skill-single-source-of-truth-design.md`

---

## 背景速览（实现者必读）

- 员工私有技能根：`EmployeeService._resolve_skill_root() / str(employee.id) / "skills"`（= `settings.skill_path/<id>/skills`）。每个技能是一个含 `SKILL.md` 的子目录。
- 运行时加载：`apps/server/src/service/agent/employee.py:84` `list_available_skills(skills_root)` 只列含 `SKILL.md` 的子目录 → DB 不参与运行时。
- 已有 meta 机制：`LocalSkillService._read_meta(skill_dir)` / `_write_meta(skill_dir, meta)` 读写 `<skill_dir>/.skill-meta.json`（`META_FILE_NAME = ".skill-meta.json"`，`SKILL_MD_NAME = "SKILL.md"`）。**来源标记就加进这个 meta**。
- `EmployeeSkill` 字段：`workspace_id, user_id, employee_id, skill_id(NOT NULL, unique(employee_id,skill_id)), skill_name, skill_name_zh, skill_description, prompt, skill_content`。
- 三个走 `_replace_employee_skills` + `_save_skills_to_skill_path` 的调用点：`update_employee`(employee_service.py:924-932)、employee_service.py:1311-1314、1347-1383。

## 来源标记约定（meta 内新增键）

写进 `<私有技能目录>/.skill-meta.json`：

```json
{
  "origin": "assigned" | "grown:adopted",
  "skillId": 123,            // assigned: 库/远程真实 id；grown: 该员工内唯一的负数合成 id
  "locallyModified": false,  // 仅 assigned 有意义：被 update_skill 私改过 → true
  "displayNameZh": "中文名", // 已有键，reconcile 读它填 skill_name_zh
  "description": "…",        // 已有键
  "prompt": "…"              // 分配时落盘，reconcile 读它填 EmployeeSkill.prompt
}
```

`grown:adopted` 的 `skillId`：EmployeeSkill.skill_id 非空且 (employee_id,skill_id) 唯一，故采纳时分配**该员工目录内唯一的负数 id**：扫现有私有技能 meta 的 skillId，取 `min(existing, default=0) - 1`。存进 meta，reconcile 直接读，跨次稳定。

---

## Task 1: 来源标记 helper（foundation）

新增一个薄模块封装"读写某私有技能目录的来源标记"与"扫某员工私有 skills 根 → 标记列表"，复用 `LocalSkillService._read_meta/_write_meta`。

**Files:**
- Create: `apps/server/src/service/skill_provenance.py`
- Test: `apps/server/tests/test_skill_provenance.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/server/tests/test_skill_provenance.py
from pathlib import Path

from src.service.skill_provenance import (
    read_origin,
    write_origin,
    scan_employee_skills,
    next_grown_skill_id,
)


def _make_skill(root: Path, name: str) -> Path:
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# skill", encoding="utf-8")
    return d


def test_write_then_read_origin(tmp_path: Path):
    d = _make_skill(tmp_path, "demo")
    write_origin(d, origin="assigned", skill_id=42, prompt="P",
                 display_name_zh="演示", description="d")
    info = read_origin(d)
    assert info.origin == "assigned"
    assert info.skill_id == 42
    assert info.locally_modified is False
    assert info.display_name_zh == "演示"
    assert info.prompt == "P"


def test_read_origin_unmarked_returns_none_origin(tmp_path: Path):
    d = _make_skill(tmp_path, "legacy")
    info = read_origin(d)
    assert info.origin is None  # 未标记 → 待迁移回填


def test_scan_lists_only_skill_dirs(tmp_path: Path):
    skills = tmp_path / "skills"
    _make_skill(skills, "a")
    g = _make_skill(skills, "b")
    write_origin(g, origin="grown:adopted", skill_id=-1)
    (skills / "not-a-skill").mkdir()  # 无 SKILL.md，应被忽略
    names = {s.name for s in scan_employee_skills(skills)}
    assert names == {"a", "b"}


def test_next_grown_skill_id_is_unique_negative(tmp_path: Path):
    skills = tmp_path / "skills"
    a = _make_skill(skills, "a")
    write_origin(a, origin="grown:adopted", skill_id=-1)
    assert next_grown_skill_id(skills) == -2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_skill_provenance.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```python
# apps/server/src/service/skill_provenance.py
"""员工私有技能副本的来源标记（provenance）：复用 .skill-meta.json，
不引入新文件约定。磁盘是唯一真相，本模块只负责读写标记 + 扫描。"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from src.service.local_skill_service import LocalSkillService

SKILL_MD = LocalSkillService.SKILL_MD_NAME


@dataclass
class SkillOrigin:
    name: str
    origin: str | None            # "assigned" | "grown:adopted" | None(未标记)
    skill_id: int | None
    locally_modified: bool
    display_name_zh: str | None
    description: str | None
    prompt: str | None


def _is_skill_dir(p: Path) -> bool:
    return p.is_dir() and (p / SKILL_MD).is_file()


def read_origin(skill_dir: Path) -> SkillOrigin:
    meta = LocalSkillService._read_meta(skill_dir)
    sid = meta.get("skillId")
    try:
        sid = int(sid) if sid is not None else None
    except (TypeError, ValueError):
        sid = None
    return SkillOrigin(
        name=skill_dir.name,
        origin=(meta.get("origin") or None),
        skill_id=sid,
        locally_modified=bool(meta.get("locallyModified", False)),
        display_name_zh=(meta.get("displayNameZh") or None),
        description=(meta.get("description") or None),
        prompt=(meta.get("prompt") or None),
    )


def write_origin(
    skill_dir: Path,
    *,
    origin: str,
    skill_id: int,
    locally_modified: bool | None = None,
    prompt: str | None = None,
    display_name_zh: str | None = None,
    description: str | None = None,
) -> None:
    """合并写入标记到 .skill-meta.json（保留已有键）。"""
    meta = LocalSkillService._read_meta(skill_dir)
    meta["origin"] = origin
    meta["skillId"] = skill_id
    if locally_modified is not None:
        meta["locallyModified"] = bool(locally_modified)
    elif "locallyModified" not in meta:
        meta["locallyModified"] = False
    if prompt is not None:
        meta["prompt"] = prompt
    if display_name_zh is not None:
        meta["displayNameZh"] = display_name_zh
    if description is not None:
        meta["description"] = description
    LocalSkillService._write_meta(skill_dir, meta)


def set_locally_modified(skill_dir: Path, value: bool = True) -> None:
    meta = LocalSkillService._read_meta(skill_dir)
    meta["locallyModified"] = bool(value)
    LocalSkillService._write_meta(skill_dir, meta)


def scan_employee_skills(skills_root: Path) -> list[SkillOrigin]:
    if not skills_root.is_dir():
        return []
    return [
        read_origin(child)
        for child in sorted(skills_root.iterdir())
        if _is_skill_dir(child)
    ]


def next_grown_skill_id(skills_root: Path) -> int:
    """该员工目录内唯一的负数合成 id（grown 技能用）。"""
    existing = [s.skill_id for s in scan_employee_skills(skills_root) if s.skill_id is not None]
    return min([*existing, 0]) - 1
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_skill_provenance.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/skill_provenance.py apps/server/tests/test_skill_provenance.py
git commit -m "feat(skill): 私有技能来源标记 helper(复用 .skill-meta.json)"
```

---

## Task 2: reconcile_employee_skills（核心投影函数）

新增 `EmployeeService.reconcile_employee_skills(db, employee)`：扫该员工私有 skills 根 → 让 `EmployeeSkill` 行与磁盘集合一致（按 `skill_name` 对齐：磁盘有DB无→插、DB有磁盘无→删、都有→更新字段），字段从 meta(标记) + `SKILL.md`(skill_content) 读出；末尾刷新 `employee.meta_json`（复用 `_refresh_employee_meta_skills`）。未标记的旧目录在此**回填**标记（迁移自愈）。

**Files:**
- Modify: `apps/server/src/service/employee_service.py`（新增方法，import skill_provenance）
- Test: `apps/server/tests/test_reconcile_employee_skills.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/server/tests/test_reconcile_employee_skills.py
from pathlib import Path

from sqlalchemy import select

from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.service.employee_service import EmployeeService
from src.service import skill_provenance


def _seed_employee(db_session, tmp_path, monkeypatch) -> Employee:
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    emp = Employee(workspace_id=1, user_id="u1", name="测试员工", employee_code="t1")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    return emp


def _disk_skill(tmp_path, emp_id, name, *, origin, skill_id, content="# c"):
    d = tmp_path / str(emp_id) / "skills" / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(content, encoding="utf-8")
    skill_provenance.write_origin(d, origin=origin, skill_id=skill_id)
    return d


def test_reconcile_inserts_rows_from_disk(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    _disk_skill(tmp_path, emp.id, "alpha", origin="assigned", skill_id=10)
    _disk_skill(tmp_path, emp.id, "beta", origin="grown:adopted", skill_id=-1)

    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()

    rows = db_session.scalars(
        select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)
    ).all()
    assert {r.skill_name for r in rows} == {"alpha", "beta"}


def test_reconcile_deletes_rows_without_disk(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    _disk_skill(tmp_path, emp.id, "alpha", origin="assigned", skill_id=10)
    db_session.add(EmployeeSkill(workspace_id=1, user_id="u1", employee_id=emp.id,
                                 skill_id=99, skill_name="ghost"))
    db_session.commit()

    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()

    names = {r.skill_name for r in db_session.scalars(
        select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)).all()}
    assert names == {"alpha"}  # ghost 被删


def test_reconcile_backfills_unmarked_dir(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    # 无标记旧目录（模拟老数据）
    d = tmp_path / str(emp.id) / "skills" / "legacy"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# c", encoding="utf-8")

    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()

    info = skill_provenance.read_origin(d)
    assert info.origin is not None  # 已回填（无库匹配 → grown:adopted）
```

> 注：`db_session` fixture 见 `apps/server/tests/conftest.py`（既有）。若该 fixture 名不同，实现时对齐现有测试用法。

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_reconcile_employee_skills.py -v`
Expected: FAIL（`reconcile_employee_skills` 不存在）

- [ ] **Step 3: Write minimal implementation**

在 `EmployeeService` 内新增（import 放文件内既有 import 区或方法内）：

```python
    @staticmethod
    def reconcile_employee_skills(db: Session, employee: Employee) -> None:
        """唯一的「磁盘 → EmployeeSkill」投影。幂等。改动磁盘技能集后必调。"""
        from pathlib import Path
        from src.service import skill_provenance
        from src.service.basic_file_reader import read_text_with_encoding_fallback

        skills_root = (
            EmployeeService._resolve_skill_root() / str(employee.id) / "skills"
        )
        disk = skill_provenance.scan_employee_skills(skills_root)

        # 迁移自愈：回填未标记目录
        for info in disk:
            if info.origin is None:
                d = skills_root / info.name
                # 名字匹配现有 assigned 行 → assigned；否则 grown:adopted
                row = db.scalars(
                    select(EmployeeSkill).where(
                        EmployeeSkill.employee_id == employee.id,
                        EmployeeSkill.skill_name == info.name,
                    )
                ).first()
                if row is not None and row.skill_id > 0:
                    skill_provenance.write_origin(
                        d, origin="assigned", skill_id=row.skill_id)
                else:
                    skill_provenance.write_origin(
                        d, origin="grown:adopted",
                        skill_id=skill_provenance.next_grown_skill_id(skills_root))
        disk = skill_provenance.scan_employee_skills(skills_root)  # 重读（含回填）

        disk_by_name = {info.name: info for info in disk}
        existing = {
            r.skill_name: r
            for r in db.scalars(
                select(EmployeeSkill).where(EmployeeSkill.employee_id == employee.id)
            ).all()
        }

        # 删：DB 有磁盘无
        for name, row in existing.items():
            if name not in disk_by_name:
                db.delete(row)

        # 插 / 更新
        for name, info in disk_by_name.items():
            skill_md = skills_root / name / skill_provenance.SKILL_MD
            content = (
                read_text_with_encoding_fallback(skill_md)
                if skill_md.is_file() else None
            )
            row = existing.get(name)
            if row is None:
                row = EmployeeSkill(
                    workspace_id=employee.workspace_id,
                    user_id=employee.user_id,
                    employee_id=employee.id,
                    skill_id=info.skill_id if info.skill_id is not None else
                        skill_provenance.next_grown_skill_id(skills_root),
                    skill_name=name,
                )
                db.add(row)
            row.skill_name_zh = info.display_name_zh or ""
            row.skill_description = info.description
            row.prompt = info.prompt
            row.skill_content = content

        db.flush()
        EmployeeService._refresh_employee_meta_skills(db, employee)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_reconcile_employee_skills.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/employee_service.py apps/server/tests/test_reconcile_employee_skills.py
git commit -m "feat(skill): reconcile_employee_skills 磁盘→DB 单向投影(含迁移回填)"
```

---

## Task 3: 分配改增量 + 用 reconcile 替换 DB 全量重写

把 `_save_skills_to_skill_path` 从 `rmtree 整目录再重写` 改为**增量**：只 copy 新增的 `assigned`、只删被取消的 `assigned`、**绝不碰 `grown:*`**；落盘时写来源标记。三个调用点把 `_replace_employee_skills(...)` 替换为 `reconcile_employee_skills(db, employee)`。

**Files:**
- Modify: `apps/server/src/service/employee_service.py`（`_save_skills_to_skill_path` 改写；`update_employee:929`、`:1311`、`:1378` 三处删 `_replace_employee_skills` 调用，改在落盘后调 reconcile）
- Test: `apps/server/tests/test_assignment_incremental.py`

- [ ] **Step 1: Write the failing test**（核心 bug #2：再分配不冲掉成长技能）

```python
# apps/server/tests/test_assignment_incremental.py
from pathlib import Path

from src.service.employee_service import EmployeeService
from src.service import skill_provenance


def test_incremental_assign_preserves_grown(tmp_path, monkeypatch):
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root",
                        staticmethod(lambda: tmp_path))

    class _Emp:  # 轻量替身：_save_skills_to_skill_path 只用 employee.id
        id = 7
    emp = _Emp()
    root = tmp_path / "7" / "skills"

    # 预置一个成长技能（采纳得来）
    grown = root / "grown-skill"
    grown.mkdir(parents=True)
    (grown / "SKILL.md").write_text("# grown", encoding="utf-8")
    skill_provenance.write_origin(grown, origin="grown:adopted", skill_id=-1)

    # 分配一个库技能（local source，从某目录 copy）
    lib = tmp_path / "lib" / "lib-skill"
    lib.mkdir(parents=True)
    (lib / "SKILL.md").write_text("# lib", encoding="utf-8")
    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "lib-skill", "source": "local", "path": str(lib), "id": 5},
    ])

    # 成长技能仍在；库技能也在
    assert (grown / "SKILL.md").is_file()
    assert (root / "lib-skill" / "SKILL.md").is_file()
    assert skill_provenance.read_origin(root / "lib-skill").origin == "assigned"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_assignment_incremental.py -v`
Expected: FAIL（现 rmtree 整目录 → grown-skill 被删）

- [ ] **Step 3: Write minimal implementation**

改写 `_save_skills_to_skill_path`（employee_service.py:770）。关键：去掉 `shutil.rmtree(employee_root)`；按 `desired`（入参 skills 的 skillName 集）算 to_add / to_remove，仅作用于 `assigned:*`，落盘后写标记。提取单技能落盘为内部 helper `_materialize_one_skill(employee_root, skill)`（保留现有 local copytree / remote file_map 逻辑），返回该技能目录。伪代码：

```python
    @staticmethod
    def _save_skills_to_skill_path(employee, skills: list[dict]) -> Path:
        from src.service import skill_provenance
        employee_root = EmployeeService._resolve_skill_root() / str(employee.id) / "skills"
        employee_root.mkdir(parents=True, exist_ok=True)

        desired = {
            str(s.get("skillName")).strip(): s
            for s in skills
            if isinstance(s, dict) and str(s.get("skillName") or "").strip()
        }

        # 现有磁盘上的 assigned 技能
        current_assigned = {
            info.name for info in skill_provenance.scan_employee_skills(employee_root)
            if info.origin == "assigned"
        }

        # 删：被取消的 assigned（grown:* 不在 current_assigned，天然不删）
        for name in current_assigned - set(desired):
            shutil.rmtree(employee_root / name, ignore_errors=True)

        # 增/更新：desired 中的库/远程技能（已存在的 assigned 也重写为库版本——
        # 注意 locallyModified 的 assigned 不应被无脑覆盖？分配是显式人工动作，
        # 按 spec「再次分配增删别的技能时不碰已选中的」——故已在 current_assigned
        # 且仍被选中的，跳过重 copy，保住其改进）
        for name, skill in desired.items():
            if name in current_assigned:
                continue  # 已分配且仍选中 → 不动（保住 locallyModified 改进）
            target = EmployeeService._materialize_one_skill(employee_root, skill)
            if target is not None:
                skill_provenance.write_origin(
                    target,
                    origin="assigned",
                    skill_id=int(skill.get("id") or 0),
                    prompt=EmployeeService._skill_detail_prompt_to_text(skill.get("prompt")),
                    display_name_zh=str(skill.get("displayNameZh") or "") or None,
                    description=skill.get("description"),
                )
        return employee_root
```

`_materialize_one_skill`：把现有 for-loop 体（local copytree / remote file_map 写入，含 `.history` ignore、`_safe_skill_file_path`）抽成单技能版本，返回 `skill_dir`（无内容则 None）。

三个调用点改造：删 `_replace_employee_skills(db, employee, payloads)`，在 `employee.skills_json = _build_skills_json_payload(...)` 之后加 `EmployeeService.reconcile_employee_skills(db, employee)`。（`_replace_employee_skills` 若无其它引用可删除；保留亦无害但应停止调用。）

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_assignment_incremental.py tests/test_reconcile_employee_skills.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/employee_service.py apps/server/tests/test_assignment_incremental.py
git commit -m "feat(skill): 分配改增量(不碰 grown),落盘写标记,DB 走 reconcile"
```

---

## Task 4: 采纳候选 → 写标记 + reconcile（bug #1 档案可见）

`adopt_skill_candidate`（employee_service.py:~1535）写完 `brain/skills/<slug>/SKILL.md` 后：写 `grown:adopted` 标记（分配负数 id）+ `reconcile_employee_skills`。

**Files:**
- Modify: `apps/server/src/service/employee_service.py`（`adopt_skill_candidate`）
- Test: `apps/server/tests/test_adopt_visible_in_db.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/server/tests/test_adopt_visible_in_db.py
from sqlalchemy import select
from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.service.employee_service import EmployeeService, _growth_brain_root_for
from src.service import skill_provenance


def test_adopt_candidate_becomes_employee_skill_row(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    emp = Employee(workspace_id=1, user_id="u1", name="员工", employee_code="t1")
    db_session.add(emp); db_session.commit(); db_session.refresh(emp)

    brain = _growth_brain_root_for(emp.id)  # = tmp_path/<id>
    cand = brain / "skill_candidates"; cand.mkdir(parents=True)
    (cand / "my-skill.md").write_text("# My Skill\ncontent", encoding="utf-8")

    EmployeeService.adopt_skill_candidate(db_session, emp.id, "my-skill")
    db_session.commit()

    rows = db_session.scalars(
        select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)).all()
    assert any(r.skill_name == "my-skill" for r in rows)  # 档案可见
    skill_dir = brain / "skills" / "my-skill"
    assert skill_provenance.read_origin(skill_dir).origin == "grown:adopted"
```

- [ ] **Step 2: Run → FAIL**

Run: `uv run pytest tests/test_adopt_visible_in_db.py -v`
Expected: FAIL（无 EmployeeSkill 行）

- [ ] **Step 3: Implement** — `adopt_skill_candidate` 在 `(target_dir/"SKILL.md").write_text(...)` 之后、`cand.unlink()` 附近补：

```python
        from src.service import skill_provenance
        skills_root = brain / "skills"
        skill_provenance.write_origin(
            target_dir, origin="grown:adopted",
            skill_id=skill_provenance.next_grown_skill_id(skills_root))
        emp = db.get(Employee, employee_id)
        if emp is not None:
            EmployeeService.reconcile_employee_skills(db, emp)
```

（`adopt_skill_candidate` 当前签名已带 `db`、`employee_id`；`brain = _growth_brain_root_for(employee_id)` 已在方法内。）

- [ ] **Step 4: Run → PASS**

Run: `uv run pytest tests/test_adopt_visible_in_db.py -v`

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/employee_service.py apps/server/tests/test_adopt_visible_in_db.py
git commit -m "fix(skill): 采纳候选写标记+reconcile,档案立刻可见"
```

---

## Task 5: update_skill 重做为只改私有副本（路 2）

`_apply_skill_update`（update_skill_tool.py:139）去掉 `ensure_editable_from_employee_copy` / `update_local_skill` / `sync_local_skill_to_assignees`，改为直接写该员工私有副本的 `SKILL.md`；`.history` 落私有目录；被改 assigned → 置 `locallyModified=true`；末尾 reconcile。重写其现有测试。

**Files:**
- Modify: `apps/server/src/service/agent/update_skill_tool.py`（`_apply_skill_update`、`_backup_skill_version`）
- Test: 重写 `apps/server/tests/test_update_skill*.py`（既有），新增 `apps/server/tests/test_update_skill_private_only.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/server/tests/test_update_skill_private_only.py
from src.models.employee import Employee
from src.service.agent.update_skill_tool import _apply_skill_update
from src.service.employee_service import EmployeeService
from src.service import skill_provenance


def test_update_skill_writes_private_copy_only(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    # 若库写入/广播被调用则 fail
    import src.service.local_skill_service as lss
    import src.service.employee_service as es
    monkeypatch.setattr(lss.LocalSkillService, "update_local_skill",
                        staticmethod(lambda *a, **k: (_ for _ in ()).throw(AssertionError("库不应被写"))))
    monkeypatch.setattr(es.EmployeeService, "sync_local_skill_to_assignees",
                        staticmethod(lambda *a, **k: (_ for _ in ()).throw(AssertionError("不应广播"))))
    monkeypatch.setattr("src.db.session.get_session_local", lambda: (lambda: db_session))

    emp = Employee(workspace_id=1, user_id="u1", name="员工", employee_code="t1")
    db_session.add(emp); db_session.commit(); db_session.refresh(emp)
    d = tmp_path / str(emp.id) / "skills" / "skl"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# old", encoding="utf-8")
    skill_provenance.write_origin(d, origin="assigned", skill_id=3)

    out = _apply_skill_update(emp.id, "skl", "# new content", "修了个错")

    assert "失败" not in out
    assert (d / "SKILL.md").read_text(encoding="utf-8") == "# new content"
    assert skill_provenance.read_origin(d).locally_modified is True
```

- [ ] **Step 2: Run → FAIL**

Run: `uv run pytest tests/test_update_skill_private_only.py -v`
Expected: FAIL（现实现会调库 → AssertionError）

- [ ] **Step 3: Implement** — `_apply_skill_update` 主体替换为：

```python
    from src.db.session import get_session_local
    from src.models.employee import Employee
    from src.service.employee_service import EmployeeService
    from src.service import skill_provenance

    db = get_session_local()()
    try:
        emp = db.get(Employee, employee_id)
        if emp is None:
            return "拒绝：未找到员工记录。"
        skill_dir = (
            EmployeeService._resolve_skill_root() / str(employee_id) / "skills" / skill_name
        )
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            return f"拒绝：技能「{skill_name}」私有副本不存在。"
        backup_version = _backup_skill_version_private(skill_dir)  # 见下
        skill_md.write_text(new_content, encoding="utf-8")
        info = skill_provenance.read_origin(skill_dir)
        if info.origin == "assigned":
            skill_provenance.set_locally_modified(skill_dir, True)
        EmployeeService.reconcile_employee_skills(db, emp)
        db.commit()
        _write_skill_edit_audit(employee_id, skill_name, reason, new_content, backup_version)
        _clear_skill_hint(employee_id, skill_name)
        return f"已更新你的技能「{skill_name}」（仅你自己的副本）。"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("update_skill failed: %s", exc, exc_info=True)
        return f"更新技能「{skill_name}」失败：{exc}"
    finally:
        db.close()
```

`_backup_skill_version_private(skill_dir)`：把 `_backup_skill_version` 改为接收私有 `skill_dir`，备份其 `SKILL.md` 到 `skill_dir/.history/<ts>.md`，返回 ts（去掉 builtin 防御与 workspace 解析）。

- [ ] **Step 4: 重写既有 update_skill 测试**

跑 `uv run pytest tests/ -k update_skill -v` 找出因去掉库写入/广播而失败的旧用例，逐个改为针对"私有副本写入 + locallyModified + reconcile"的断言（删掉对 `update_local_skill`/`sync_local_skill_to_assignees` 的 monkeypatch 期望）。

- [ ] **Step 5: Run → PASS & Commit**

```bash
uv run pytest tests/ -k update_skill -v
git add apps/server/src/service/agent/update_skill_tool.py apps/server/tests/
git commit -m "feat(skill): update_skill 改为只改私有副本(去库写入+广播),按员工隔离"
```

---

## Task 6: 库维护广播加 (b) 守卫（私有改进优先）

`sync_local_skill_to_assignees`（employee_service.py:1074，由 skill_api 库编辑触发）：覆盖某 assignee 私有副本前，若其 `locallyModified` 或 origin 为 `grown:*` → **跳过**；推送后对受影响 assignee `reconcile`。

**Files:**
- Modify: `apps/server/src/service/employee_service.py`（`sync_local_skill_to_assignees` 循环体）
- Test: `apps/server/tests/test_sync_skips_locally_modified.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/server/tests/test_sync_skips_locally_modified.py
# 构造两个 assignee：A 私改过(locallyModified)、B 没改；
# 触发 sync 后断言 A 的 SKILL.md 内容未被覆盖、B 的被更新。
# （参考既有 test_sync_local_skill* 的装配方式搭 workspace 库技能与 EmployeeSkill 行。）
```

> 实现者：照 `apps/server/tests/` 既有 `sync_local_skill_to_assignees` 测试的夹具搭场景；断言重点是 A 内容不变 + B 内容变。

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — 在 `sync_local_skill_to_assignees` 的 `for employee_id in employee_ids:` 循环内，定位 `target_dir` 后、`rmtree+copytree` 前插入跳过判断：

```python
            from src.service import skill_provenance
            if target_dir.is_dir():
                info = skill_provenance.read_origin(target_dir)
                if info.locally_modified or (info.origin or "").startswith("grown"):
                    continue  # (b) 私有改进优先：不覆盖
```

循环末尾把 `_refresh_employee_meta_skills(db, employee)` 替换/补为 `EmployeeService.reconcile_employee_skills(db, employee)`（覆盖后内容变，reconcile 刷新行）。

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/employee_service.py apps/server/tests/test_sync_skips_locally_modified.py
git commit -m "feat(skill): 库编辑广播跳过已私改员工(边界 b 私有改进优先)"
```

---

## Task 7: 全量回归 + unassign 走 reconcile

收口：`unassign_local_skill_from_assignees`（employee_service.py:1170）末尾把 `_refresh_employee_meta_skills` 改为 reconcile；跑全量确认无回归。

**Files:**
- Modify: `apps/server/src/service/employee_service.py`（`unassign_local_skill_from_assignees`）

- [ ] **Step 1: 改 unassign 末尾调 reconcile**（删私有目录 + 删行后，对每个受影响 employee 调 `reconcile_employee_skills`，保证投影一致）。

- [ ] **Step 2: 全量回归**

Run: `uv run pytest -q`
Expected: 仅既有的 1 个 pre-existing 失败（`test_workspace_crud_userlevel.py::test_create_user_workspace_empty`，用户 WIP），其余全绿。逐个排查本次新引入的失败并修复。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/service/employee_service.py
git commit -m "chore(skill): unassign 收口走 reconcile + 全量回归通过"
```

---

## Task 8（可选，可后置）: 档案/履历 `grown:*` 角标

前端在档案"分配技能"或履历"技能"给 `grown:adopted` 技能加"成长得来"角标。需后端在某员工技能读取接口暴露 origin。**不阻塞核心**，可独立 PR。

---

## 验证基线

- 后端全量：`cd apps/server && uv run pytest -q` → 除既有 1 个 workspace WIP 失败外全绿。
- 不变量守护（务必有测试覆盖）：分配的"移除"只作用于 `assigned:*`，`grown:*` 永不被分配/同步删除或覆盖。
- 手测路径（重启后）：① 采纳候选 → 档案立刻出现；② 档案加/减库技能 → 成长技能与改进版仍在；③ 员工 update_skill 改技能 → 只该员工变、同事不变；④ 工作区库编辑技能 → 未私改员工更新、已私改员工保留自己版本。
