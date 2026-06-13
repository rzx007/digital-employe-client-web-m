# 员工自造技能体验改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个员工都能用 skill-creator 造技能，造完在对话里挂显眼「保存为技能」卡片，一键原子完成「入本地技能库 + 挂当前员工 + 永久可用」。

**Architecture:** 后端三块——(A) `get_agent` 运行时注入 skill-creator 到每个 agent；(C) 新接口 `POST /skills/local/save-draft` 复用 `import_local_skill_zip` + `update_employee` 原子完成入库与挂员工。前端 (B) 识别「该轮写入了 skills-draft 技能」并渲染 `DraftSkillSaveCard`，与文件变更面板去重。

**Tech Stack:** Python FastAPI + SQLAlchemy（后端，`uv` + `pytest`）；React 19 + TanStack + Vitest（前端）。

设计依据：`docs/superpowers/specs/2026-06-13-employee-skill-creation-uplift-design.md`

---

## File Structure

后端：
- `apps/server/src/service/local_skill_service.py` — 新增 `pack_skill_dir_to_zip()`（目录打 zip）与 `save_draft_skill()`（协调入库）
- `apps/server/src/service/employee_service.py` — 新增 `get_employee_local_skill_ids()`（取员工现有负数 localId 列表）
- `apps/server/src/api/skill_api.py` — 新接口 `POST /skills/local/save-draft`
- `apps/server/src/schemas/skill.py` — `SaveDraftSkillRequest` / `SaveDraftSkillResult`
- `apps/server/src/service/agent/employee.py` — 注入 skill-creator 到 `skill_sources` + `available_skills`
- `apps/server/src/service/agent/skill_sources.py` — 新建 helper `resolve_builtin_skill_creator_source()`
- `apps/server/tests/test_save_draft_skill.py` — 新建
- `apps/server/tests/test_skill_creator_injection.py` — 新建

前端：
- `apps/web/src/api/skill.ts` — `saveDraftSkill()`
- `apps/web/src/lib/chat/skill-frontmatter.ts` — 新建，抽出 `parseSimpleFrontmatter`
- `apps/web/src/lib/chat/message-classifier.ts` — 新 `draft-skill-save` 块
- `apps/web/src/lib/chat/file-change-utils.ts` — 过滤已被保存卡接管的 skill-folder
- `apps/web/src/components/chat/message-blocks/draft-skill-save-card.tsx` — 新建
- `apps/web/src/components/chat/message-blocks/block-render-map.tsx` — 渲染分支
- `apps/web/src/components/artifact/import-draft-skill-dialog.tsx` — 改用共享 parseSimpleFrontmatter

---

## 前置说明（执行者必读）

- 后端测试运行目录是 `apps/server`，命令 `uv run pytest <path> -v`。
- 前端测试：`apps/web` 下 `pnpm test:unit`（vitest）；类型检查 `node_modules/.bin/tsc --noEmit`（在 `apps/web`）；lint `node_modules/.bin/eslint <files>`。
- 本 worktree 已 `pnpm install`，`node_modules` 就绪。
- 提交信息结尾加：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 关键既有事实：
  - `import_local_skill_zip(skill_name, file_name, file_bytes, overwrite=False, workspace_id=None, display_name_zh=None) -> dict`（返回 `{skillName, localId, path, overwritten}`），`local_skill_service.py:463`。它内部 `_extract_zip_to_temp` + `_detect_skill_source_root`，期望 zip 里含一个带 `SKILL.md` 的技能目录。
  - `EmployeeService.update_employee(db, employee_id, payload: EmployeeUpdate, token) -> Employee`，当 `payload.skill_ids` set 时按 localId 重挂技能（`employee_service.py:832/864`）。`EmployeeUpdate.skill_ids: Optional[List[int]]`（`schemas/employee.py:89`）。
  - 员工现有技能在 `employee_skills` 表（`_employee_skills_snapshot`，`employee_service.py:190`），其中本地技能的 `skill_id` 为负数 localId。
  - 草稿目录真实路径 = 员工 workspace 下 `artifacts/conv-<conversationId>/skills-draft/<name>/`（`agent/employee.py:136` 写入；`workspace_paths.resolve_workspace_dirs` 给根）。
  - `get_workspace_id_from_request(request) -> int`（`core/request_utils.py:52`）。
  - `ResponseBase[T]` 是统一响应包装；schema 用 `from pydantic import BaseModel`。

---

## Task 1: 后端 helper — 解析内置 skill-creator 源目录

**Files:**
- Create: `apps/server/src/service/agent/skill_sources.py`
- Test: `apps/server/tests/test_skill_creator_injection.py`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_skill_creator_injection.py`:

```python
from pathlib import Path

from src.service.agent.skill_sources import resolve_builtin_skill_creator_source


def test_resolve_skill_creator_source_returns_existing_dir():
    src = resolve_builtin_skill_creator_source()
    # 仓库内 build-in-skills/skill-creator 必然存在
    assert src is not None
    assert src.name == "skill-creator"
    assert (src / "SKILL.md").is_file()


def test_resolve_skill_creator_source_missing_returns_none(monkeypatch):
    import src.service.agent.skill_sources as mod

    monkeypatch.setattr(mod, "_candidate_skill_creator_dirs", lambda: [Path("/no/such/dir/skill-creator")])
    assert mod.resolve_builtin_skill_creator_source() is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_skill_creator_injection.py -v`
Expected: FAIL，`ModuleNotFoundError: src.service.agent.skill_sources`

- [ ] **Step 3: 实现 helper**

Create `apps/server/src/service/agent/skill_sources.py`:

```python
"""解析内置 skill-creator 技能源目录，供 get_agent 运行时全员注入。"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_SKILL_CREATOR_NAME = "skill-creator"


def _candidate_skill_creator_dirs() -> list[Path]:
    """候选源目录，优先已 seed 的 local-skills/builtin，回退打包源 build-in-skills。"""
    from src.service.local_skill_service import LocalSkillService

    candidates: list[Path] = []
    try:
        builtin_root = LocalSkillService._resolve_builtin_root()  # local-skills/builtin
        candidates.append(builtin_root / _SKILL_CREATOR_NAME)
    except Exception as exc:  # noqa: BLE001 - 路径解析失败不致命
        logger.warning("resolve builtin_root for skill-creator failed: %s", exc)
    try:
        packaged_root = LocalSkillService._resolve_packaged_builtin_skills_root()
        candidates.append(packaged_root / _SKILL_CREATOR_NAME)
    except Exception as exc:  # noqa: BLE001
        logger.warning("resolve packaged build-in-skills root failed: %s", exc)
    return candidates


def resolve_builtin_skill_creator_source() -> Path | None:
    """返回首个存在且含 SKILL.md 的 skill-creator 目录；都缺失返回 None（不致命）。"""
    for cand in _candidate_skill_creator_dirs():
        if cand.is_dir() and (cand / "SKILL.md").is_file():
            return cand
    logger.info("skill-creator source not found in any candidate; skip injection")
    return None
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_skill_creator_injection.py -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/skill_sources.py apps/server/tests/test_skill_creator_injection.py
git commit -m "feat(skill): 新增 resolve_builtin_skill_creator_source helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 后端 — get_agent 注入 skill-creator

**Files:**
- Modify: `apps/server/src/service/agent/employee.py:151-153`（skill_sources 组装）与 `:61`（available_skills）
- Test: `apps/server/tests/test_skill_creator_injection.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `apps/server/tests/test_skill_creator_injection.py` 末尾追加：

```python
def test_inject_skill_creator_appends_source_and_name():
    from src.service.agent.employee import _augment_skills_with_skill_creator

    sources = ["/emp/skills"]
    available = ["docx"]
    new_sources, new_available = _augment_skills_with_skill_creator(sources, available)
    assert any(s.endswith("skill-creator") for s in new_sources)
    assert "skill-creator" in new_available


def test_inject_skill_creator_dedupes_when_employee_already_has_it():
    from src.service.agent.employee import _augment_skills_with_skill_creator

    sources = ["/emp/skills"]
    available = ["skill-creator", "docx"]
    new_sources, new_available = _augment_skills_with_skill_creator(sources, available)
    # 已自有：available 不重复，且不追加内置源（保留员工自有那份）
    assert new_available.count("skill-creator") == 1
    assert not any(s.endswith("skill-creator") for s in new_sources)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/server && uv run pytest tests/test_skill_creator_injection.py -v`
Expected: FAIL，`cannot import name '_augment_skills_with_skill_creator'`

- [ ] **Step 3: 实现注入函数并接入 get_agent**

在 `apps/server/src/service/agent/employee.py` 顶部 import 区加：

```python
from src.service.agent.skill_sources import resolve_builtin_skill_creator_source
```

在 `get_agent` 之前（模块级）新增函数：

```python
def _augment_skills_with_skill_creator(
    skill_sources: list[str], available_skills: list[str]
) -> tuple[list[str], list[str]]:
    """全员运行时注入 skill-creator：员工已自有则不重复加载，仅保证 available 含之。"""
    new_available = list(available_skills)
    if "skill-creator" in new_available:
        return list(skill_sources), new_available
    src = resolve_builtin_skill_creator_source()
    new_sources = list(skill_sources)
    if src is not None:
        new_sources.append(str(src))
    new_available.append("skill-creator")
    return new_sources, new_available
```

然后在 `get_agent` 里，定位现有（`employee.py:151-153`）：

```python
    skill_sources = [str(skills_root)]
    if has_draft_route and draft_dir is not None:
        skill_sources.append(str(draft_dir))
```

在其**后**追加一行注入，并同步 `available_skills`：

```python
    skill_sources, available_skills = _augment_skills_with_skill_creator(
        skill_sources, available_skills
    )
```

（`available_skills` 在 `employee.py:61` 已定义为局部变量，重新赋值即可；它在 `build_system_prompt(current_time, available_skills, ...)` 处被消费，`employee.py:212-214`。）

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/server && uv run pytest tests/test_skill_creator_injection.py -v`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/employee.py apps/server/tests/test_skill_creator_injection.py
git commit -m "feat(skill): get_agent 运行时全员注入 skill-creator（已自有则去重）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 后端 — 目录打 zip helper

**Files:**
- Modify: `apps/server/src/service/local_skill_service.py`（新增 `pack_skill_dir_to_zip`）
- Test: `apps/server/tests/test_save_draft_skill.py`（新建）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_save_draft_skill.py`:

```python
import io
import zipfile
from pathlib import Path

from src.service.local_skill_service import LocalSkillService


def _make_draft(tmp_path: Path) -> Path:
    d = tmp_path / "skills-draft" / "demo-skill"
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: demo-skill\ndescription: 演示\n---\n# Demo\n", encoding="utf-8")
    (d / "scripts" / "run.py").write_text("print('hi')\n", encoding="utf-8")
    return d


def test_pack_skill_dir_to_zip_contains_all_files(tmp_path):
    draft = _make_draft(tmp_path)
    data = LocalSkillService.pack_skill_dir_to_zip(draft)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
    # zip 内以技能目录名为根
    assert "demo-skill/SKILL.md" in names
    assert "demo-skill/scripts/run.py" in names


def test_pack_skill_dir_to_zip_rejects_missing_skill_md(tmp_path):
    d = tmp_path / "skills-draft" / "no-md"
    d.mkdir(parents=True)
    (d / "note.txt").write_text("x", encoding="utf-8")
    try:
        LocalSkillService.pack_skill_dir_to_zip(d)
        assert False, "应因缺少 SKILL.md 抛错"
    except Exception:
        pass
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py -v`
Expected: FAIL，`AttributeError: ... pack_skill_dir_to_zip`

- [ ] **Step 3: 实现 pack_skill_dir_to_zip**

在 `apps/server/src/service/local_skill_service.py` 的 `LocalSkillService` 类里新增静态方法（放在 `import_local_skill_zip` 上方即可）：

```python
    @staticmethod
    def pack_skill_dir_to_zip(skill_dir: Path) -> bytes:
        """把一个技能目录打包成 zip（zip 内以目录名为根）。要求含 SKILL.md。"""
        import io
        import zipfile

        skill_dir = Path(skill_dir)
        if not skill_dir.is_dir():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"草稿技能目录不存在: {skill_dir}",
            )
        if not (skill_dir / LocalSkillService.SKILL_MD_NAME).is_file():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="草稿技能缺少 SKILL.md，无法保存",
            )
        root_name = skill_dir.name
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(skill_dir.rglob("*")):
                if path.is_file():
                    arcname = f"{root_name}/{path.relative_to(skill_dir).as_posix()}"
                    zf.write(path, arcname)
        return buf.getvalue()
```

（`HTTPException` / `status` 在该文件已 import；确认文件顶部已有 `from fastapi import HTTPException, status` —— 若无则补。）

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/local_skill_service.py apps/server/tests/test_save_draft_skill.py
git commit -m "feat(skill): 新增 pack_skill_dir_to_zip（目录打包给 import 复用）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 后端 — 取员工现有本地技能 localId

**Files:**
- Modify: `apps/server/src/service/employee_service.py`（新增 `get_employee_local_skill_ids`）
- Test: `apps/server/tests/test_save_draft_skill.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `apps/server/tests/test_save_draft_skill.py` 末尾追加：

```python
def test_get_employee_local_skill_ids_filters_negative(monkeypatch):
    from src.service.employee_service import EmployeeService

    fake_snapshot = [
        {"skill_id": -3, "skillName": "a"},
        {"skill_id": 10, "skillName": "remote-b"},  # 远程正数，排除
        {"skill_id": -7, "skillName": "c"},
    ]
    monkeypatch.setattr(
        EmployeeService, "_employee_skills_snapshot",
        staticmethod(lambda db, employee: fake_snapshot),
    )

    class _Emp:  # 占位，_employee_skills_snapshot 被 mock 不会真用它
        id = 1

    ids = EmployeeService.get_employee_local_skill_ids(db=None, employee=_Emp())
    assert sorted(ids) == [-7, -3]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py::test_get_employee_local_skill_ids_filters_negative -v`
Expected: FAIL，`AttributeError: ... get_employee_local_skill_ids`

- [ ] **Step 3: 实现**

在 `apps/server/src/service/employee_service.py` 的 `EmployeeService` 类里，紧挨 `_employee_skills_snapshot`（`:190`）下方新增：

```python
    @staticmethod
    def get_employee_local_skill_ids(db, employee) -> list[int]:
        """该员工现有的本地/工作区技能 localId（负数）列表。"""
        snapshot = EmployeeService._employee_skills_snapshot(db, employee)
        ids: list[int] = []
        for row in snapshot:
            sid = row.get("skill_id")
            if isinstance(sid, int) and sid < 0:
                ids.append(sid)
        return ids
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py::test_get_employee_local_skill_ids_filters_negative -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/employee_service.py apps/server/tests/test_save_draft_skill.py
git commit -m "feat(employee): 新增 get_employee_local_skill_ids

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 后端 — save_draft_skill 协调方法

**Files:**
- Modify: `apps/server/src/service/local_skill_service.py`（新增 `save_draft_skill`）
- Test: `apps/server/tests/test_save_draft_skill.py`（追加）

入参用真实草稿目录路径（由 API 层解析后传入），方法只负责「入库 + 返回 localId」；挂员工在 API 层做（依赖 db/token，见 Task 6）。

- [ ] **Step 1: 追加失败测试**

在 `tests/test_save_draft_skill.py` 末尾追加：

```python
def test_save_draft_skill_imports_and_returns_localid(tmp_path, monkeypatch):
    draft = _make_draft(tmp_path)

    captured = {}

    def fake_import(skill_name, file_name, file_bytes, overwrite=False, workspace_id=None, display_name_zh=None):
        captured["skill_name"] = skill_name
        captured["workspace_id"] = workspace_id
        return {"skillName": skill_name, "localId": -42, "path": "/x", "overwritten": False}

    monkeypatch.setattr(LocalSkillService, "import_local_skill_zip", staticmethod(fake_import))

    result = LocalSkillService.save_draft_skill(
        draft_dir=draft, skill_name="demo-skill", workspace_id=5, overwrite=False
    )
    assert result["localId"] == -42
    assert result["skillName"] == "demo-skill"
    assert captured["workspace_id"] == 5
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py::test_save_draft_skill_imports_and_returns_localid -v`
Expected: FAIL，`AttributeError: ... save_draft_skill`

- [ ] **Step 3: 实现**

在 `LocalSkillService` 里（紧挨 `import_local_skill_zip` 下方）新增：

```python
    @staticmethod
    def save_draft_skill(
        *,
        draft_dir: Path,
        skill_name: str,
        workspace_id: int,
        overwrite: bool = False,
        display_name_zh: str | None = None,
    ) -> dict:
        """把草稿目录注册进本地技能库（复用 import 链路），返回 import 结果含 localId。"""
        zip_bytes = LocalSkillService.pack_skill_dir_to_zip(draft_dir)
        return LocalSkillService.import_local_skill_zip(
            skill_name=skill_name,
            file_name=f"{skill_name}.zip",
            file_bytes=zip_bytes,
            overwrite=overwrite,
            workspace_id=workspace_id,
            display_name_zh=display_name_zh,
        )
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py::test_save_draft_skill_imports_and_returns_localid -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/local_skill_service.py apps/server/tests/test_save_draft_skill.py
git commit -m "feat(skill): 新增 save_draft_skill（打包草稿 + 复用 import 入库）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 后端 — schemas + API 接口

**Files:**
- Modify: `apps/server/src/schemas/skill.py`（新增两个 model）
- Modify: `apps/server/src/api/skill_api.py`（新接口）
- Test: `apps/server/tests/test_save_draft_skill.py`（追加 API 层逻辑测试）

- [ ] **Step 1: 加 schema**

在 `apps/server/src/schemas/skill.py` 末尾追加：

```python
class SaveDraftSkillRequest(BaseModel):
    conversationId: int
    skillName: str
    employeeId: int
    overwrite: bool = False
    displayNameZh: str | None = None


class SaveDraftSkillResult(BaseModel):
    skillName: str
    localId: int
    employeeId: int
    overwritten: bool = False
    attachedToEmployee: bool = True
    attachError: str | None = None
```

- [ ] **Step 2: 写失败测试（草稿目录解析 + 挂员工编排）**

在 `tests/test_save_draft_skill.py` 末尾追加：

```python
def test_resolve_draft_dir_rejects_traversal():
    from src.api.skill_api import _resolve_draft_skill_dir

    try:
        _resolve_draft_skill_dir(conversation_id=1, skill_name="../evil")
        assert False, "应拒绝穿越"
    except Exception:
        pass
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py::test_resolve_draft_dir_rejects_traversal -v`
Expected: FAIL，`cannot import name '_resolve_draft_skill_dir'`

- [ ] **Step 4: 实现解析 helper + 接口**

在 `apps/server/src/api/skill_api.py` 顶部 import 区补：

```python
from pathlib import Path

from src.core.config import get_settings
from src.schemas.skill import SaveDraftSkillRequest, SaveDraftSkillResult
from src.schemas.employee import EmployeeUpdate
from src.service.employee_service import EmployeeService
from src.service.resource_service import resolve_workspace_context
```

（上面有的已 import 则跳过。）新增草稿目录解析（拒绝穿越）：

```python
def _resolve_draft_skill_dir(conversation_id: int, skill_name: str) -> Path:
    name = (skill_name or "").strip()
    if not name or "/" in name or "\\" in name or ".." in name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"非法草稿技能名: {skill_name}",
        )
    settings = get_settings()
    root_path = settings.skill_path  # employees-skills 根；resolve_workspace_context 内部据此定位
    workspace_dir, _public, _conv, _room = resolve_workspace_context(
        root_path, conversation_id
    )
    draft_dir = workspace_dir / f"conv-{conversation_id}" / "skills-draft" / name
    resolved = draft_dir.resolve()
    # 二次防穿越：必须落在该会话 skills-draft 下
    base = (workspace_dir / f"conv-{conversation_id}" / "skills-draft").resolve()
    if base not in resolved.parents and resolved != base:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="草稿路径越界",
        )
    if not resolved.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"草稿技能不存在: {name}",
        )
    return resolved
```

> 注：`resolve_workspace_context(root_path, conversation_id)` 返回 `(workspace_dir, public_root, conv_artifacts, room_dir)`（`resource_service.py:267`）；`workspace_dir` 即员工 workspace 根，草稿在其 `conv-<id>/skills-draft/` 下（与 `agent/employee.py:136` 写入一致）。

接口本体（放在文件已有 import 接口附近）：

```python
@router.post(
    "/skills/local/save-draft",
    response_model=ResponseBase[SaveDraftSkillResult],
    status_code=status.HTTP_200_OK,
)
def save_draft_skill(
    request: Request,
    payload: SaveDraftSkillRequest,
    db: Session = Depends(get_db),
) -> ResponseBase[SaveDraftSkillResult]:
    workspace_id = get_workspace_id_from_request(request)
    token = request.headers.get("token") or ""

    draft_dir = _resolve_draft_skill_dir(payload.conversationId, payload.skillName)

    # 1+2. 入本地技能库（失败=整体失败，409 由 import 抛出）
    imported = LocalSkillService.save_draft_skill(
        draft_dir=draft_dir,
        skill_name=payload.skillName,
        workspace_id=workspace_id,
        overwrite=payload.overwrite,
        display_name_zh=payload.displayNameZh,
    )
    local_id = int(imported["localId"])

    # 3. 挂到当前员工（失败不回滚入库，返回 attachedToEmployee=False）
    attached = True
    attach_error: str | None = None
    try:
        employee = EmployeeService.get_employee(db, payload.employeeId)
        existing = EmployeeService.get_employee_local_skill_ids(db, employee)
        new_ids = sorted(set(existing) | {local_id})
        EmployeeService.update_employee(
            db,
            payload.employeeId,
            EmployeeUpdate(skill_ids=new_ids),
            token,
        )
    except Exception as exc:  # noqa: BLE001 - 入库已成功，挂员工失败降级
        attached = False
        attach_error = str(exc)
        logger.warning(
            "save_draft_skill attach-to-employee failed: emp=%s local_id=%s err=%s",
            payload.employeeId, local_id, exc,
        )

    logger.info(
        "save_draft_skill done: skill=%s local_id=%s emp=%s overwritten=%s attached=%s",
        imported["skillName"], local_id, payload.employeeId,
        imported.get("overwritten", False), attached,
    )
    return ResponseBase[SaveDraftSkillResult](
        data=SaveDraftSkillResult(
            skillName=imported["skillName"],
            localId=local_id,
            employeeId=payload.employeeId,
            overwritten=bool(imported.get("overwritten", False)),
            attachedToEmployee=attached,
            attachError=attach_error,
        )
    )
```

> 确认 `skill_api.py` 顶部已有 `logger = logging.getLogger(__name__)`、`from sqlalchemy.orm import Session`、`from src.db.session import get_db`、`ResponseBase`、`get_workspace_id_from_request`；缺则补齐（参考同文件 `update_local_skill` 端点的依赖写法）。

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py -v`
Expected: PASS（全部）

- [ ] **Step 6: 全量后端测试不回归**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py tests/test_skill_creator_injection.py tests/test_prompt_invariants.py -v`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/schemas/skill.py apps/server/src/api/skill_api.py apps/server/tests/test_save_draft_skill.py
git commit -m "feat(skill): 新增 POST /skills/local/save-draft 一体化保存接口

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 前端 — 抽出共享 frontmatter 解析 + saveDraftSkill API

**Files:**
- Create: `apps/web/src/lib/chat/skill-frontmatter.ts`
- Modify: `apps/web/src/components/artifact/import-draft-skill-dialog.tsx`（改用共享函数）
- Modify: `apps/web/src/api/skill.ts`（新增 `saveDraftSkill`）

- [ ] **Step 1: 抽出 parseSimpleFrontmatter**

Create `apps/web/src/lib/chat/skill-frontmatter.ts`:

```typescript
export function parseSimpleFrontmatter(content: string): {
  description: string
  body: string
} {
  const match = content.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) {
    return { description: "", body: content }
  }
  const frontmatterText = match[1]
  const body = content.slice(match[0].length)
  const descMatch = frontmatterText.match(/description\s*[:：]\s*(.+)/)
  const description = descMatch
    ? descMatch[1].trim().replace(/^["']|["']$/g, "")
    : ""
  return { description, body }
}
```

- [ ] **Step 2: import-draft-skill-dialog 改用共享函数**

在 `apps/web/src/components/artifact/import-draft-skill-dialog.tsx`：删除文件内本地的 `parseSimpleFrontmatter` 函数定义（`:23-38`），改为顶部 import：

```typescript
import { parseSimpleFrontmatter } from "@/lib/chat/skill-frontmatter"
```

- [ ] **Step 3: 新增 saveDraftSkill API**

在 `apps/web/src/api/skill.ts` 末尾追加（沿用文件已有的 `request` 与 `ApiResponse` 模式，参考 `importLocalSkill`）：

```typescript
export interface SaveDraftSkillResult {
  skillName: string
  localId: number
  employeeId: number
  overwritten: boolean
  attachedToEmployee: boolean
  attachError: string | null
}

export async function saveDraftSkill(params: {
  conversationId: number
  skillName: string
  employeeId: number
  overwrite?: boolean
  displayNameZh?: string
}): Promise<SaveDraftSkillResult> {
  const res = await request<ApiResponse<SaveDraftSkillResult>>(
    "/skills/local/save-draft",
    {
      method: "POST",
      body: JSON.stringify({
        conversationId: params.conversationId,
        skillName: params.skillName,
        employeeId: params.employeeId,
        overwrite: params.overwrite ?? false,
        displayNameZh: params.displayNameZh,
      }),
    }
  )
  return res.data!
}
```

> 注：`body`/`method` 写法以 `apps/web/src/api/skill.ts` 现有 POST 调用（如 `uploadLocalSkillToRemote`）为准；若该文件用的是 axios 风格而非 fetch 风格，按其实际签名调整。先 Read `skill.ts:51-115` 对齐再写。

- [ ] **Step 4: 类型检查 + lint**

Run: `cd apps/web && node_modules/.bin/tsc --noEmit`
Expected: 退出码 0

Run: `cd apps/web && node_modules/.bin/eslint src/lib/chat/skill-frontmatter.ts src/api/skill.ts src/components/artifact/import-draft-skill-dialog.tsx`
Expected: 退出码 0

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/chat/skill-frontmatter.ts apps/web/src/api/skill.ts apps/web/src/components/artifact/import-draft-skill-dialog.tsx
git commit -m "feat(skill): 抽出共享 parseSimpleFrontmatter + saveDraftSkill API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 前端 — message-classifier 产出 draft-skill-save 块

**Files:**
- Modify: `apps/web/src/lib/chat/message-classifier.ts`（新块类型 + 分类）
- Test: 在 `apps/web/src` 下新增/沿用 vitest 用例

需先 Read `message-classifier.ts` 了解 `ClassifiedBlock` 联合定义、`getFileChangesFromUIMessage` 调用点（`:626`）、以及块如何按 message.parts 生成。本任务依赖 `getFileChangesFromUIMessage` 已能识别 `kind: "skill-folder"`（`file-change-utils.ts`）。

- [ ] **Step 1: 加块类型**

在 `apps/web/src/lib/chat/message-classifier.ts` 的 `ClassifiedBlock` 联合类型中加（紧挨 `file-changes` 那一项，`:205`）：

```typescript
  | {
      kind: "draft-skill-save"
      key: string
      skillName: string
      skillPath: string
    }
```

- [ ] **Step 2: 分类逻辑**

在生成 `file-changes` 块的同一处（`getFileChangesFromUIMessage(message)` 调用点附近，`:626`），新增：从该 message 的 file changes 里挑出 `kind === "skill-folder"` 的项，每个产出一个 `draft-skill-save` 块（`skillName=item.title`、`skillPath=item.path`、`key="draft-skill-save:"+item.path`）。示例（按文件实际结构融入）：

```typescript
const fileChanges = getFileChangesFromUIMessage(message)
const skillFolders = fileChanges.filter((f) => f.kind === "skill-folder")
for (const sf of skillFolders) {
  blocks.push({
    kind: "draft-skill-save",
    key: `draft-skill-save:${sf.path}`,
    skillName: sf.title,
    skillPath: sf.path,
  })
}
```

- [ ] **Step 3: 类型检查**

Run: `cd apps/web && node_modules/.bin/tsc --noEmit`
Expected: 退出码 0（block-render-map 暂未处理新 kind 会触发 switch 穷尽报错 → 由 Task 9 补；若 tsc 此时报 block-render-map 未处理，先继续 Task 9 再一起验。**本步允许 block-render-map 相关错误，其余须 0**）

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/chat/message-classifier.ts
git commit -m "feat(skill): message-classifier 产出 draft-skill-save 块

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 前端 — DraftSkillSaveCard 组件 + 渲染分支 + 面板去重

**Files:**
- Create: `apps/web/src/components/chat/message-blocks/draft-skill-save-card.tsx`
- Modify: `apps/web/src/components/chat/message-blocks/block-render-map.tsx`（渲染分支）
- Modify: `apps/web/src/lib/chat/file-change-utils.ts`（过滤被卡片接管的 skill-folder）

- [ ] **Step 1: 实现卡片组件**

Create `apps/web/src/components/chat/message-blocks/draft-skill-save-card.tsx`:

```typescript
import * as React from "react"
import { IconBulb, IconCheck, IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { saveDraftSkill, checkLocalSkillNameExists } from "@/api/skill"
import { useChatStore } from "@/stores/chat-store"

export function DraftSkillSaveCard({
  skillName,
  className,
}: {
  skillName: string
  skillPath: string
  className?: string
}) {
  const conversationId = useChatStore((s) => s.selectedConversationId)
  const employeeId = useChatStore((s) => s.selectedEmployeeId)
  const [saved, setSaved] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // 持久化：重载后据本地技能库是否已存在同名技能反映「已保存」，不依赖易失 state。
  React.useEffect(() => {
    let cancelled = false
    checkLocalSkillNameExists(skillName)
      .then((exists) => {
        if (!cancelled && exists) setSaved(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [skillName])

  const handleSave = async () => {
    if (conversationId == null || employeeId == null) {
      toast.error("无法确定当前会话或员工")
      return
    }
    setSaving(true)
    try {
      const res = await saveDraftSkill({
        conversationId: Number(conversationId),
        skillName,
        employeeId: Number(employeeId),
      })
      setSaved(true)
      toast.success(
        res.attachedToEmployee
          ? `技能「${res.skillName}」已保存，当前员工已永久拥有`
          : `技能「${res.skillName}」已入技能库，但挂到当前员工失败，可在员工配置手动添加`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败，请稍后重试"
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={cn(
        "not-prose flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5",
        className
      )}
    >
      <IconBulb className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          员工新学会了技能：{skillName}
        </p>
        <p className="text-xs text-muted-foreground">
          保存后该技能将进入技能库，当前员工永久拥有，其他员工招聘时也可选用
        </p>
      </div>
      <Button
        size="sm"
        disabled={saving || saved}
        onClick={handleSave}
        className="shrink-0"
      >
        {saving ? (
          <span className="flex items-center gap-1.5">
            <IconLoader2 className="size-3.5 animate-spin" />
            保存中
          </span>
        ) : saved ? (
          <span className="flex items-center gap-1.5">
            <IconCheck className="size-3.5" />
            已加入技能库
          </span>
        ) : (
          "保存到我的技能库"
        )}
      </Button>
    </div>
  )
}
```

> 注：`selectedEmployeeId` 字段名以 `apps/web/src/stores/chat-store.ts` 实际为准——先 Grep 确认当前会话对应的员工 id 怎么取（可能叫 `currentEmployeeId` 或从 conversation 派生）。若 store 无直接字段，改为从已有的会话信息派生。

- [ ] **Step 2: 渲染分支**

在 `apps/web/src/components/chat/message-blocks/block-render-map.tsx`：
- 顶部 import：`import { DraftSkillSaveCard } from "./draft-skill-save-card"`
- 在 `BlockRenderer` 里 `if (block.kind === "file-changes")` 分支旁新增：

```typescript
  if (block.kind === "draft-skill-save") {
    return (
      <DraftSkillSaveCard
        key={block.key}
        skillName={block.skillName}
        skillPath={block.skillPath}
        className="w-full"
      />
    )
  }
```

- [ ] **Step 3: 文件变更面板去重**

在 `apps/web/src/lib/chat/file-change-utils.ts` 的 `getFileChangesFromUIMessage` 返回前，过滤掉 `kind === "skill-folder"` 的项（它们已由 draft-skill-save 卡片承载）。修改返回：

```typescript
  return Array.from(changes.values()).filter((c) => c.kind !== "skill-folder")
```

> 影响确认：`file-change-cards.tsx` 里 skill-folder 专属的「导入技能库」`+` 按钮与 `ImportDraftSkillDialog` 将不再从文件变更面板触发（改由保存卡片承载）。`ImportDraftSkillDialog` 组件本身保留（技能库 UI 仍可用本地导入）。

- [ ] **Step 4: 类型检查 + lint（前端全绿）**

Run: `cd apps/web && node_modules/.bin/tsc --noEmit`
Expected: 退出码 0（switch 穷尽错误此时应消失）

Run: `cd apps/web && node_modules/.bin/eslint src/components/chat/message-blocks/draft-skill-save-card.tsx src/components/chat/message-blocks/block-render-map.tsx src/lib/chat/file-change-utils.ts src/lib/chat/message-classifier.ts`
Expected: 退出码 0

- [ ] **Step 5: prettier**

Run: `cd "D:/doc/code/ai/digital-employee-client/.claude/worktrees/recursing-banach-09527d" && node_modules/.bin/prettier --write apps/web/src/components/chat/message-blocks/draft-skill-save-card.tsx apps/web/src/lib/chat/skill-frontmatter.ts`

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/chat/message-blocks/draft-skill-save-card.tsx apps/web/src/components/chat/message-blocks/block-render-map.tsx apps/web/src/lib/chat/file-change-utils.ts
git commit -m "feat(skill): DraftSkillSaveCard 卡片 + 渲染分支 + 面板去重

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: 端到端冒烟与文档

**Files:**
- Modify: `apps/server/src/service/agent/AGENTS.md`（可选：提示员工可造技能并保存）

- [ ] **Step 1: 后端全量相关测试**

Run: `cd apps/server && uv run pytest tests/test_save_draft_skill.py tests/test_skill_creator_injection.py -v`
Expected: PASS

- [ ] **Step 2: 前端类型 + 单测**

Run: `cd apps/web && node_modules/.bin/tsc --noEmit && pnpm test:unit`
Expected: tsc 退出码 0；vitest 全过

- [ ] **Step 3: AGENTS.md 补一句（可选但推荐）**

在 `apps/server/src/service/agent/AGENTS.md` 的技能相关段落补：员工可用 `skill-creator` 技能创建新技能（写到草稿目录即可立即在本会话使用）；造好后提示用户可在对话里点「保存到我的技能库」让该技能永久生效并可复用。具体文案融入现有「技能」相关小节，保持风格一致。

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/service/agent/AGENTS.md
git commit -m "docs(agent): 说明员工可用 skill-creator 造技能并一键保存

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 验证清单（实现完成后人工确认）

- [ ] 任意新招员工对话中，问「你能造技能吗」→ 模型知道自己有 skill-creator
- [ ] 让员工造一个技能 → 对话里出现显眼「保存为技能」卡片（不再只藏在文件变更的 `+`）
- [ ] 文件变更面板不再重复显示该草稿技能文件夹
- [ ] 点「保存到我的技能库」→ toast 成功；技能库 UI 出现该技能；当前员工技能配置含该技能
- [ ] 重新招另一个员工时，技能选单里能勾选到这个新保存的技能
- [ ] 同名再保存（无 overwrite）→ 友好提示已存在
