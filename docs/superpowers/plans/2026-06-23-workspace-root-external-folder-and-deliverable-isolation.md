# 工作空间根 + 外部文件夹 + 产物按轮隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 默认工作空间根改为 app 托管 `projects/<id>`；放开外部文件夹工作空间（flat 直挂、非空、自动授权、前端文件夹选择器）；定时轮交付物按 run 隔离只归本轮会话。

**Architecture:** 三组件独立可落。A：`ensure_default_workspace` 用 `APP_PROJECTS_BASE/<id>` + init_db 迁移盘根脏值。B：`resolve_workspace_product_root`/`resolve_workspace_dirs` 对外部 root flat（root 即产物根，artifacts/uploads 平铺，draft 保持 root/skills-draft），create_user_workspace 外部自动授权，前端加 select-directory IPC + 文件夹选择器。C：`collect_plan_deliverables` 加 run 过滤，session_flags 加 run_id，API 按 conversation 解析 run，前端 per-run 会话渲染本轮交付物。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / pytest（内存 SQLite）/ React 19 / Electron / TypeScript.

**Spec:** [docs/superpowers/specs/2026-06-23-workspace-root-external-folder-and-deliverable-isolation-design.md](../specs/2026-06-23-workspace-root-external-folder-and-deliverable-isolation-design.md)

---

## 关键约定
- 后端路径相对 `apps/server/`，前端相对 `apps/web/`。后端 `cd apps/server && uv run pytest <path> -v`；前端 typecheck `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`。
- 基线：后端 `1 failed, ~1019 passed`（pre-existing test_create_user_workspace_empty）。每任务零新增 failed。
- 显式 `git add <文件>`，禁 `git add -A`。提交结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 测试用内存 SQLite `db_session` fixture（conftest）。

---

## 组件A：默认工作空间根 → projects/<id>

### Task A1: ensure_default_workspace / create_workspace 用 app 托管根

**Files:** Modify `src/service/workspace_service.py`. Test: NEW `tests/test_workspace_root_consolidation.py`.

- [ ] **Step 1: 失败测试**

新建 `tests/test_workspace_root_consolidation.py`：

```python
def test_ensure_default_workspace_uses_app_projects_base(db_session, monkeypatch):
    from src.service.workspace_service import WorkspaceService
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE
    # 不真建目录：patch mkdir 成 no-op
    import pathlib
    monkeypatch.setattr(pathlib.Path, "mkdir", lambda self, **k: None)
    ws = WorkspaceService.ensure_default_workspace(db_session)
    from pathlib import Path
    assert Path(ws.root_path) == APP_PROJECTS_BASE / str(ws.id)
```

- [ ] **Step 2: 跑确认失败**
Run: `cd apps/server && uv run pytest tests/test_workspace_root_consolidation.py::test_ensure_default_workspace_uses_app_projects_base -v` → FAIL（现在是盘根）。

- [ ] **Step 3: 实现**

`src/service/workspace_service.py` `ensure_default_workspace`（~127）：把 `default_root = WorkspaceService._resolve_default_root()` 改为：
```python
        from src.service.agent.workspace_paths import APP_PROJECTS_BASE
        default_root = APP_PROJECTS_BASE / str(default_workspace_id)
        default_root.mkdir(parents=True, exist_ok=True)
```
`create_workspace`（~146）无 root 回退同改为 `APP_PROJECTS_BASE/<新id>`——但该函数建 ws 前没 id；保持现状用 `_resolve_default_root` 也可，**本任务只改 ensure_default_workspace**（默认空间是关键）。若 `_resolve_default_root` 仅被 create_workspace 用，保留不动（避免牵连）。

- [ ] **Step 4: 通过 + 回归**
Run: `cd apps/server && uv run pytest tests/test_workspace_root_consolidation.py -v && uv run pytest tests/test_workspace_crud_userlevel.py -q`
Expected: 新测试 PASS；既有 workspace 测试零新增失败（test_create_user_workspace_empty 仍是预存）。

- [ ] **Step 5: Commit**
```bash
cd "D:\code\company\digital-employe-client-web-main"
git add apps/server/src/service/workspace_service.py apps/server/tests/test_workspace_root_consolidation.py
git commit -m "feat(ws): 默认工作空间根用 app 托管 projects/<id>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task A2: init_db 迁移盘根脏值

**Files:** Modify `src/db/init_db.py`. Test: APPEND `tests/test_workspace_root_consolidation.py`.

- [ ] **Step 1: 失败测试**
```python
def test_migrate_default_workspace_drive_root(db_session):
    from src.db.init_db import _migrate_default_workspace_root
    from src.models.workspace import Workspace
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE
    from pathlib import Path
    # 脏：盘根
    dirty = Workspace(id=1, name="默认", root_path=str(Path(Path.cwd().anchor)), user_id="1")
    db_session.add(dirty); db_session.commit()
    _migrate_default_workspace_root(db_session.get_bind())
    db_session.expire_all()
    assert Path(db_session.get(Workspace, 1).root_path) == APP_PROJECTS_BASE / "1"


def test_migrate_does_not_touch_app_managed_or_external(db_session):
    from src.db.init_db import _migrate_default_workspace_root
    from src.models.workspace import Workspace
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE
    app_managed = Workspace(id=2, name="ok", root_path=str(APP_PROJECTS_BASE / "2"), user_id="u")
    external = Workspace(id=3, name="ext", root_path="D:\\myproject\\sub", user_id="u")
    db_session.add_all([app_managed, external]); db_session.commit()
    _migrate_default_workspace_root(db_session.get_bind())
    db_session.expire_all()
    assert str(APP_PROJECTS_BASE / "2") in db_session.get(Workspace, 2).root_path
    assert db_session.get(Workspace, 3).root_path == "D:\\myproject\\sub"  # 外部显式根不动
```

- [ ] **Step 2: 跑确认失败** → FAIL（函数不存在）。

- [ ] **Step 3: 实现 + 挂 init_db**

`src/db/init_db.py` 加，并在 `init_db()` 里 `_ensure_*` 之后、`_cleanup_legacy_subtask_cron_plans` 附近调用：
```python
def _migrate_default_workspace_root(engine) -> None:
    """把"盘根回退"产生的默认工作空间 root（如 'D:\\' / 'C:\\'）迁到 app 托管 projects/<id>。
    只动恰好等于盘根 anchor 的脏值；不动 app 托管根、不动用户显式选的外部子目录。"""
    from pathlib import Path
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE
    inspector = inspect(engine)
    if "workspaces" not in set(inspector.get_table_names()):
        return
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, root_path FROM workspaces")).all()
        for wid, rp in rows:
            if not rp:
                continue
            p = Path(rp)
            # 脏值判定：root_path 恰好是个盘根 anchor（'D:\\' / 'C:\\' / '/'）
            if str(p).rstrip("\\/") == p.anchor.rstrip("\\/") and p.anchor:
                managed = APP_PROJECTS_BASE / str(wid)
                managed.mkdir(parents=True, exist_ok=True)
                conn.execute(text("UPDATE workspaces SET root_path=:rp WHERE id=:id"),
                             {"rp": str(managed), "id": wid})
                logger.info("迁移默认工作空间根 ws#%s: %r -> %s", wid, rp, managed)
```

- [ ] **Step 4: 通过 + 全量** → `cd apps/server && uv run pytest tests/test_workspace_root_consolidation.py -v && uv run pytest -q`（1 failed 预存）。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/db/init_db.py apps/server/tests/test_workspace_root_consolidation.py
git commit -m "feat(ws): init_db 迁移盘根脏值默认工作空间根 -> projects/<id>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 组件B：外部文件夹工作空间（flat / 非空 / 自动授权 + 前端选择器）

### Task B1: 外部 root flat 路径解析

**Files:** Modify `src/service/agent/workspace_paths.py`. Test: APPEND `tests/test_workspace_root_consolidation.py`.

- [ ] **Step 1: 失败测试**
```python
def test_external_root_product_root_is_flat(tmp_path):
    from src.service.agent.workspace_paths import resolve_workspace_product_root, APP_PROJECTS_BASE
    from pathlib import Path
    ext = str(tmp_path / "mycode")
    # 外部：直接是该文件夹本身，无 .boban-staff
    assert resolve_workspace_product_root(ext) == Path(ext)
    # app 托管：保持现状
    managed = str(APP_PROJECTS_BASE / "5")
    assert resolve_workspace_product_root(managed) == Path(managed)


def test_external_dirs_flat_artifacts_uploads(tmp_path):
    from src.service.agent.workspace_paths import resolve_workspace_dirs
    from pathlib import Path
    ext = str(tmp_path / "mycode")
    dirs = resolve_workspace_dirs(root_path=ext, base_dir=Path(ext))
    root = Path(ext)
    assert dirs.artifacts_dir == root and dirs.workspace_dir == root
    assert dirs.public_dir == root and dirs.public_root == root
    assert dirs.uploads_dir == root           # 平铺
    assert dirs.draft_dir == root / "skills-draft"  # draft 保持子目录(双消费者一致)


def test_app_managed_dirs_unchanged(tmp_path):
    from src.service.agent.workspace_paths import resolve_workspace_dirs, APP_PROJECTS_BASE
    from pathlib import Path
    managed = str(APP_PROJECTS_BASE / "7")
    dirs = resolve_workspace_dirs(root_path=managed, base_dir=Path(managed))
    assert dirs.artifacts_dir == Path(managed) / "artifacts"   # 托管仍子目录
```

- [ ] **Step 2: 跑确认失败** → FAIL。

- [ ] **Step 3: 实现**

`resolve_workspace_product_root`（~38）：外部分支返回 `p` 本身（删 `.boban-staff` 套层）：
```python
def resolve_workspace_product_root(root_path: str) -> Path:
    p = Path(root_path)
    if p.is_relative_to(APP_PROJECTS_BASE):
        return p
    return p  # 外部文件夹：直接用其本身（flat，不再套 .boban-staff）
```
（保留 docstring 说明外部=flat。）

`resolve_workspace_dirs`（~49）：内部判 is_external，分支给目录：
```python
def resolve_workspace_dirs(*, root_path, base_dir) -> WorkspaceDirs:
    root = Path(root_path) if root_path else Path(base_dir)
    is_external = not root.is_relative_to(APP_PROJECTS_BASE)
    if is_external:
        # 外部 flat：产物/上传平铺在文件夹本身；draft 仍子目录(双消费者一致、不污染留余地)
        artifacts_dir = workspace_dir = public_dir = public_root = root
        uploads_dir = root
        draft_dir = root / "skills-draft"
    else:
        artifacts_dir = workspace_dir = public_dir = public_root = root / "artifacts"
        uploads_dir = root / "uploads"
        draft_dir = root / "skills-draft"
    return WorkspaceDirs(artifacts_dir=artifacts_dir, workspace_dir=workspace_dir,
        uploads_dir=uploads_dir, draft_dir=draft_dir, public_dir=public_dir, public_root=public_root)
```

- [ ] **Step 4: 通过 + 回归** → `cd apps/server && uv run pytest tests/test_workspace_root_consolidation.py -v && uv run pytest -q`（注意：既有依赖 `<external>/.boban-staff` 的测试若存在会破——grep `.boban-staff` 测试，适配为 flat 预期，不弱化）。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/service/agent/workspace_paths.py apps/server/tests/
git commit -m "feat(ws): 外部文件夹工作空间 flat 直挂（root即产物根,artifacts/uploads平铺,draft保留子目录）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task B2: create_user_workspace 外部自动授权 + 非空 + exists 校验

**Files:** Modify `src/service/workspace_service.py`. Test: APPEND.

- [ ] **Step 1: 失败测试**
```python
def test_create_user_workspace_external_auto_grants(db_session, tmp_path):
    from src.service.workspace_service import WorkspaceService
    from src.service.authorized_dir_service import list_authorized_dirs
    ext = str(tmp_path / "repo"); (tmp_path / "repo").mkdir()
    (tmp_path / "repo" / "existing.txt").write_text("x")  # 非空
    ws = WorkspaceService.create_user_workspace(db_session, user_id="u", name="ext", root_path=ext)
    assert ws.root_path == ext
    assert ws.auto_grant_external_dirs is True
    dirs = list_authorized_dirs(db_session, ws.id)
    assert any(ext in str(d) for d in dirs)  # 已自动授权


def test_create_user_workspace_external_missing_path_errors(db_session, tmp_path):
    from src.service.workspace_service import WorkspaceService
    import pytest
    with pytest.raises(Exception):  # 不存在 → 报错(HTTPException 或 ValueError)
        WorkspaceService.create_user_workspace(db_session, user_id="u", name="x",
            root_path=str(tmp_path / "nope"))
```

(先 READ `create_user_workspace` + `authorized_dir_service.list_authorized_dirs`/`grant_dir` 签名 + auto_grant_external_dirs 列；按真实签名调整断言。)

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**
在 `create_user_workspace`（~179）：传入 root_path 且**不在 APP_PROJECTS_BASE 下**（外部）时——
```python
        if root_path:
            from pathlib import Path as _P
            from src.service.agent.workspace_paths import APP_PROJECTS_BASE
            rp = _P(root_path)
            is_external = not rp.is_relative_to(APP_PROJECTS_BASE)
            if is_external and not rp.exists():
                from fastapi import HTTPException, status as _st
                raise HTTPException(status_code=_st.HTTP_400_BAD_REQUEST, detail=f"文件夹不存在：{root_path}")
            # （非空不校验，允许已有项目目录）
```
建好 workspace 后，若 is_external：
```python
            ws.auto_grant_external_dirs = True
            db.commit()
            from src.service.authorized_dir_service import grant_dir
            grant_dir(db, ws.id, root_path)
```
按 grant_dir 真实签名调用。

- [ ] **Step 4: 通过 + 全量** → 1 failed 预存。

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/service/workspace_service.py apps/server/tests/
git commit -m "feat(ws): 外部文件夹工作空间——exists校验+非空允许+自动授权

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task B3: 前端文件夹选择器（Electron IPC + 创建对话框）

**Files:** Modify Electron preload/main (select-directory IPC) + `workspace-switcher.tsx` + `api/workspace.ts`(if needed). Typecheck only (frontend).

- [ ] **Step 1: 加 select-directory IPC**
READ apps/web 的 Electron main/preload（grep `ipcMain.handle`、`openFile`、`showOpenDialog`、`contextBridge`）。仿现有 `openFile` 通道加一个 `select-directory`：main 进程 `ipcMain.handle('select-directory', () => dialog.showOpenDialog({properties:['openDirectory']}))` 返回首个路径或 null；preload `contextBridge` 暴露 `selectDirectory: () => ipcRenderer.invoke('select-directory')`。按现有命名规范对齐。

- [ ] **Step 2: 创建对话框加选择器**
`workspace-switcher.tsx` 新建工作空间对话框：在名字输入框旁加"选择文件夹（可选）"按钮 → 调 `window.<bridge>.selectDirectory()` → 回填路径到状态 → 传给 `createWorkspace(name, rootPath)`。不选=app 托管默认。加提示文案"选本地文件夹作工作空间，产物直接存入；支持已有项目目录"。`api/workspace.ts` `createWorkspace` 已支持 rootPath 参（确认；否则补）。

- [ ] **Step 3: typecheck**
`cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail` → 零新增错。

- [ ] **Step 4: Commit**
```bash
git add apps/web/<改动文件>
git commit -m "feat(ws): 前端文件夹选择器——新建工作空间可选外部本地文件夹

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 组件C：交付物按 run 隔离（Bug 3）

### Task C1: session_flags 补 run_id + collect_plan_deliverables 按 run 过滤

**Files:** Modify `plan_run_service.py`, `orchestration_lifecycle.py`. Test: NEW `tests/test_deliverable_isolation.py`.

- [ ] **Step 0: 前置确认** `TaskExecutionLog.run_id` 列存在（grep；前序特性已加）。

- [ ] **Step 1: 失败测试**
```python
def test_session_flags_has_run_id(db_session):
    from src.service.agent.orchestrator.plan_run_service import open_plan_run, create_scheduled_run_conversation
    from src.models.workspace import Workspace
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.conversation import Conversation
    import json
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    cur = Employee(workspace_id=ws.id, name="总管", employee_code="c", is_curator=True); db_session.add(cur); db_session.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="x", plan_json="[]",
        status="confirmed", total_tasks=0); db_session.add(plan); db_session.flush()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True); db_session.commit()
    cid = create_scheduled_run_conversation(db_session, plan, run)
    flags = json.loads(db_session.get(Conversation, cid).session_flags or "{}")
    assert flags["run_id"] == run.id


def test_collect_deliverables_filtered_by_run(db_session):
    """run_id 过滤：只返该轮子任务日志会话的产物。"""
    # 构造两轮 + 各自 log（不同 conversation），断言 run_id 过滤只取本轮。
    # （依据 collect_plan_deliverables 真实实现：READ 后构造最小用例——
    #  两个 PlanRun，子任务在 run1/run2 各一条 log，run_id 过滤只取对应轮的 log.conversation。）
    pass  # 实现者按 collect_plan_deliverables 真实结构写，确保 run_id 过滤生效
```
（第二个测试实现者按 `collect_plan_deliverables` 实际从 log→会话 tool parts 取产物的结构，构造能验证 run_id 过滤的最小用例；tool parts 可 monkeypatch `TaskService.get_conversation_tool_parts` 返回固定假数据按 conversation 区分。）

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**
- `plan_run_service.create_scheduled_run_conversation`：`session_flags` 的 dict 加 `"run_id": run.id`。
- `orchestration_lifecycle.collect_plan_deliverables(db, plan_id, run_id=None)`：子任务最新日志查询加可选 `run_id` 过滤——当 run_id 非空时 `.where(TaskExecutionLog.task_id==t.id, TaskExecutionLog.run_id==run_id)`（取该轮该任务最新日志）。
- 新 helper `resolve_run_id_for_conversation(db, plan_id, conversation_id) -> int | None`：查 `PlanRun where plan_id==plan_id AND conversation_id==conversation_id`，返其 id；无→None。

- [ ] **Step 4: 通过 + 全量**

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/service/agent/orchestrator/plan_run_service.py apps/server/src/service/orchestration_lifecycle.py apps/server/tests/test_deliverable_isolation.py
git commit -m "feat(orch): session_flags 加 run_id + collect_plan_deliverables 按 run 过滤 + run解析helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task C2: API 按 conversation 解析 run

**Files:** Modify `src/api/orchestration_api.py`. Test: APPEND `tests/test_deliverable_isolation.py`.

- [ ] **Step 1: 失败测试**
API 加可选 query `conversation_id`：传入 per-run 会话 id → 只返该轮 artifacts；传创建源会话(无 manual run)→空。用 TestClient 或直接调 endpoint 函数。READ get_plan 现签名后写最小用例。

- [ ] **Step 2-4: 实现 + 通过**
`get_plan(plan_id, conversation_id: int | None = None, db=...)`：若 conversation_id 给定 → `run_id = resolve_run_id_for_conversation(db, plan_id, conversation_id)` → `collect_plan_deliverables(db, plan.id, run_id=run_id)`（run_id None 时返空，避免主对话显示定时轮产物——即 conversation 非任何 run 的会话则 artifacts=[]）。不传 conversation_id → 现状（全 plan，向后兼容）。

- [ ] **Step 5: Commit**

### Task C3: 前端 per-run 会话渲染本轮交付物

**Files:** Modify `curator-turn-deliverables.tsx` + `api/orchestration.ts`. Typecheck only.

- [ ] **Step 1: 实现**
- `api/orchestration.ts` `fetchOrchestrationPlanDetail(planId, conversationId?)`：query 透传 `conversation_id`。
- `curator-turn-deliverables.tsx`：
  - 当前会话 `session_flags.kind=="scheduled_run"`：从 session_flags 取 `plan_id`，调 `fetchOrchestrationPlanDetail(plan_id, 当前conversationId)` → 渲本轮卡（不再靠 useOrchestrationPlansQuery(convId) 找 plan——per-run 会话找不到 plan）。
  - 普通会话：现有按 conversation 找 plan 逻辑，但 `fetchOrchestrationPlanDetail(planId, 当前conversationId)` 也传 conversation_id → 后端按该会话对应 run(manual) 过滤；纯定时计划创建源会话无 manual run → 后端返空 → 不显示定时轮产物。
- READ 现组件结构后最小改动接入 session_flags（会话对象需带 sessionFlags，前序已暴露）。

- [ ] **Step 2: typecheck 零新增 + Commit**

---

## 完成标准
- [ ] 全后端 `uv run pytest -q` 零新增 failed；前端 typecheck 零新增。
- [ ] 新建普通工作空间根 = projects/<id>；ws#1 重启迁移到 projects/1。
- [ ] 新建可选外部文件夹（非空 OK）→ 自动授权、产物平铺进文件夹、无 .boban-staff。
- [ ] 定时轮交付物只在本轮 per-run 会话显示；主对话不再出现定时轮产物。

## 收尾
- `superpowers:requesting-code-review` 整条 diff 复审（重点：迁移谓词精确、外部 flat 不破 app 托管、draft 双消费者一致、run 过滤、前端 IPC）。
- 手测：重启后端→ws#1 root=projects/1；新建外部文件夹工作空间产物平铺；定时轮产物只在本轮会话。
- 更新记忆。
