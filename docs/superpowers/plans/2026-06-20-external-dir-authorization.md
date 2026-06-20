# 工作区外目录写授权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当员工/总管写工作区外目录时，挡回并要求显式授权（HITL 卡片，三档 仅这次/本会话/永久 + 会话三态 询问/放行/严禁），授权后放行；读、shell、工作区内写不受影响。

**Architecture:** 写守卫（覆盖 deepagents 基类 write_file/edit_file）检测越界未授权 → 返回 error ToolMessage 提示 Agent 调 `request_external_dir_access` → 该工具登记进声明式 `interrupt_on`（复用现有 `/approve` resume 链路，**不引入动态 interrupt**）→ approve handler 按 scope 记授权 → Agent 重试写。授权状态实时查 DB（永久表 + 会话 session_flags）。

**Tech Stack:** Python FastAPI + SQLAlchemy（无 alembic，`create_all` 自动建表）；deepagents/langgraph filesystem middleware；React 19 + TanStack Query + vitest；`@workspace/ui` dropdown。

**Spec:** [docs/superpowers/specs/2026-06-20-external-dir-authorization-design.md](../specs/2026-06-20-external-dir-authorization-design.md)

**测试命令：**
- 后端：`cd apps/server && uv run pytest tests/<file>::<test> -v`
- 前端：`cd apps/web && pnpm test:unit`（vitest run）；类型：`pnpm typecheck`

---

## Phase 0 — Spike-lite（硬门：不通则停，回报用户重规划）

### Task 0: 验证可覆盖基类写工具 + 守卫内可开 DB

**目的**：spec §7 两大风险——能否在子类覆盖 write_file 前插守卫、守卫内能否实时读会话 session_flags。验证后**丢弃 spike 代码**，仅产出结论。

**Files:**
- 临时探查（不提交）：`apps/server/src/service/agent/compatible_filesystem_middleware.py`（看 read_file 覆盖如何注册到 middleware 工具集；write_file/edit_file 基类来源 `deepagents.middleware.filesystem`）

- [ ] **Step 1: 定位基类 write/edit 工具构造**

读 `compatible_filesystem_middleware.py` 中 read_file 的 `StructuredTool.from_function`（约 line 612）与 `install_compatible_filesystem_middleware`（line 640）。在 `deepagents` 包内（`.venv`）找 `FilesystemMiddleware` 如何暴露 write_file/edit_file 工具、其同步/异步函数签名与所调 backend 写方法。记录：覆盖点（是替换 middleware 的 tools 列表，还是 patch backend 写函数）。

- [ ] **Step 2: 验证守卫能拿到 conv_id + DB**

确认 `employee.py`（line ~130-187）构造 agent 时 `conversation_id`、`resolve_workspace_dirs(...)` 结果均在作用域内，可经闭包传入工具。确认能拿到 DB session 工厂（看 employee.py / chat_service 如何获取 `Session`——grep `SessionLocal` 或 `get_db` / `db_factory`）。

- [ ] **Step 3: 最小 spike——覆盖 write_file 返回固定 error**

临时在子类覆盖 write_file，让它对任意 path 直接 `return ToolMessage(status="error", content="SPIKE blocked", tool_call_id=...)`，跑一个让员工写文件的最小场景（或现有相关测试），确认：(a) 覆盖生效、Agent 收到 error；(b) 在覆盖函数里 `with db_factory() as db: db.get(Conversation, conv_id)` 能读到会话。

- [ ] **Step 4: 记录结论 + 回滚 spike**

把结论（覆盖点、DB 获取方式、签名）写进本 Task 下方 “Spike 结论” 小节。`git checkout -- <spike 改动文件>` 回滚临时代码。**若覆盖不可行或守卫内无法安全开 DB → 停止，回报用户，不进入 Phase 1。**

**Spike 结论**（实施者填写）：
- write/edit 覆盖点：______
- DB 获取方式：______
- write_file 同步/异步函数签名：______

- [ ] **Step 5: Commit（仅结论文档，无代码）**

```bash
git add docs/superpowers/plans/2026-06-20-external-dir-authorization.md
git commit -m "spike: 验证覆盖写工具+守卫内DB可达,记录结论"
```

---

## Phase 1 — 数据层（模型 + service，低风险 TDD）

### Task 1: WorkspaceAuthorizedDir 模型 + 注册 + 旧库加列

**Files:**
- Create: `apps/server/src/models/workspace_authorized_dir.py`
- Modify: `apps/server/src/models/workspace.py`（加 `auto_grant_external_dirs` 列）
- Modify: `apps/server/src/models/__init__.py`（import 新模型）
- Modify: `apps/server/src/db/init_db.py`（旧库 ALTER 加列，幂等）
- Test: `apps/server/tests/test_workspace_authorized_dir_model.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_workspace_authorized_dir_model.py
from src.models.workspace import Workspace
from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir


def test_authorized_dir_persists_and_unique(db_session, workspace):
    row = WorkspaceAuthorizedDir(workspace_id=workspace.id, path="/tmp/foo")
    db_session.add(row)
    db_session.commit()
    got = db_session.query(WorkspaceAuthorizedDir).filter_by(
        workspace_id=workspace.id, path="/tmp/foo"
    ).one()
    assert got.path == "/tmp/foo"
    assert got.created_at is not None


def test_workspace_has_auto_grant_default_false(db_session, workspace):
    assert workspace.auto_grant_external_dirs is False
```

（`db_session`、`workspace` fixtures 来自 `tests/conftest.py`，仿 `test_destructive_hitl.py` 用法。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_workspace_authorized_dir_model.py -v`
Expected: FAIL（模块不存在 / Workspace 无该属性）

- [ ] **Step 3: 写模型**

```python
# src/models/workspace_authorized_dir.py
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base


class WorkspaceAuthorizedDir(Base):
    __tablename__ = "workspace_authorized_dir"
    __table_args__ = (UniqueConstraint("workspace_id", "path", name="uq_ws_auth_dir"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("workspace.id"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
```

在 `src/models/workspace.py` 加列（仿现有列风格，需 `from sqlalchemy import Boolean`）：

```python
    auto_grant_external_dirs: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
```

在 `src/models/__init__.py` 加：`from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir  # noqa: F401`

- [ ] **Step 4: 旧库幂等加列**

在 `src/db/init_db.py` 的 `create_all` 之后，仿现有 FTS5 初始化风格加幂等 ALTER（SQLite）：

```python
def _ensure_workspace_auto_grant_column(engine) -> None:
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("workspace")}
    if "auto_grant_external_dirs" not in cols:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE workspace ADD COLUMN auto_grant_external_dirs "
                "BOOLEAN NOT NULL DEFAULT 0"
            ))
```

并在 init 流程调用它（紧跟 `Base.metadata.create_all(bind=engine)`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_workspace_authorized_dir_model.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/models/ src/db/init_db.py tests/test_workspace_authorized_dir_model.py
git commit -m "feat: workspace_authorized_dir 表 + workspace.auto_grant_external_dirs 列(幂等加列)"
```

### Task 2: authorized_dir_service（永久表 CRUD）

**Files:**
- Create: `apps/server/src/service/authorized_dir_service.py`
- Test: `apps/server/tests/test_authorized_dir_service.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_authorized_dir_service.py
from src.service.authorized_dir_service import (
    grant_dir, revoke_dir, list_authorized_dirs,
)


def test_grant_is_idempotent(db_session, workspace):
    grant_dir(db_session, workspace.id, "/tmp/foo")
    grant_dir(db_session, workspace.id, "/tmp/foo")  # 重复不报错
    dirs = list_authorized_dirs(db_session, workspace.id)
    assert dirs == ["/tmp/foo"]


def test_revoke(db_session, workspace):
    grant_dir(db_session, workspace.id, "/tmp/foo")
    revoke_dir(db_session, workspace.id, "/tmp/foo")
    assert list_authorized_dirs(db_session, workspace.id) == []
```

- [ ] **Step 2: 跑测试确认失败** — `uv run pytest tests/test_authorized_dir_service.py -v` → FAIL

- [ ] **Step 3: 实现 service**

```python
# src/service/authorized_dir_service.py
from __future__ import annotations

from sqlalchemy.orm import Session

from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir


def grant_dir(db: Session, workspace_id: int, path: str) -> None:
    exists = db.query(WorkspaceAuthorizedDir).filter_by(
        workspace_id=workspace_id, path=path
    ).first()
    if exists:
        return
    db.add(WorkspaceAuthorizedDir(workspace_id=workspace_id, path=path))
    db.commit()


def revoke_dir(db: Session, workspace_id: int, path: str) -> None:
    db.query(WorkspaceAuthorizedDir).filter_by(
        workspace_id=workspace_id, path=path
    ).delete()
    db.commit()


def list_authorized_dirs(db: Session, workspace_id: int) -> list[str]:
    rows = db.query(WorkspaceAuthorizedDir).filter_by(workspace_id=workspace_id).all()
    return [r.path for r in rows]
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/authorized_dir_service.py tests/test_authorized_dir_service.py
git commit -m "feat: authorized_dir_service 永久授权目录 CRUD"
```

---

## Phase 2 — 边界判定 + 授权逻辑（纯函数 + session_flags，TDD）

### Task 3: 边界判定（collect_workspace_roots + is_outside_workspace）

**Files:**
- Create: `apps/server/src/service/agent/path_authorization.py`
- Test: `apps/server/tests/test_path_authorization_boundary.py`
- 参考：`apps/server/src/service/agent/workspace_paths.py`（`resolve_workspace_dirs`）、`resource_service.py:43`（`_resolve_safe_path` relative_to 判定）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_path_authorization_boundary.py
from pathlib import Path
from src.service.agent.path_authorization import is_outside_workspace


def test_inside_root_is_not_outside(tmp_path):
    roots = [tmp_path / "artifacts"]
    (tmp_path / "artifacts").mkdir()
    target = tmp_path / "artifacts" / "sub" / "x.txt"
    assert is_outside_workspace(str(target), roots) is False


def test_outside_all_roots_is_outside(tmp_path):
    roots = [tmp_path / "artifacts"]
    (tmp_path / "artifacts").mkdir()
    assert is_outside_workspace(str(tmp_path / "other" / "x.txt"), roots) is True


def test_dotdot_escape_is_outside(tmp_path):
    roots = [tmp_path / "artifacts"]
    (tmp_path / "artifacts").mkdir()
    escape = tmp_path / "artifacts" / ".." / "secret.txt"
    assert is_outside_workspace(str(escape), roots) is True


def test_prefix_not_fooled_by_sibling(tmp_path):
    # /foo 不应放行 /foobar
    roots = [tmp_path / "foo"]
    (tmp_path / "foo").mkdir()
    assert is_outside_workspace(str(tmp_path / "foobar" / "x"), roots) is True
```

- [ ] **Step 2: 跑测试确认失败** — FAIL（模块不存在）

- [ ] **Step 3: 实现边界判定**

```python
# src/service/agent/path_authorization.py
from __future__ import annotations

from pathlib import Path


def is_outside_workspace(target: str, roots: list[Path]) -> bool:
    """target.resolve() 不在任何 root 之下 → True(越界)。resolve 吃掉 ../ 与符号链接。"""
    try:
        t = Path(target).resolve()
    except (OSError, ValueError):
        return True
    for root in roots:
        try:
            if t.is_relative_to(Path(root).resolve()):
                return False
        except (OSError, ValueError):
            continue
    return True


def collect_workspace_roots(root_path: str, base_dir: str) -> list[Path]:
    """工作区合法写入根集合。复用 resolve_workspace_dirs。"""
    from src.service.agent.workspace_paths import resolve_workspace_dirs
    ws = resolve_workspace_dirs(root_path=root_path, base_dir=base_dir)
    return [
        ws.artifacts_dir, ws.workspace_dir, ws.uploads_dir,
        ws.draft_dir, ws.public_root,
    ]
```

（注：`collect_workspace_roots` 字段名以 Task 0 / `workspace_paths.py` 实际 `WorkspaceDirs` 为准，实施期核对。）

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/agent/path_authorization.py tests/test_path_authorization_boundary.py
git commit -m "feat: 工作区边界判定 is_outside_workspace + collect_workspace_roots"
```

### Task 4: session_flags 授权辅助（mode / granted_dirs / once 令牌）

**Files:**
- Modify: `apps/server/src/service/agent/path_authorization.py`（追加 session_flags 辅助）
- Test: `apps/server/tests/test_path_authorization_session_flags.py`
- 参考：`destructive_hitl.py:62-96`（`parse_session_flags` / `set_skip_destructive_hitl` 模式）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_path_authorization_session_flags.py
from src.service.agent.path_authorization import (
    get_external_dir_mode, set_external_dir_mode,
    add_session_granted_dir, get_session_granted_dirs,
    add_once_granted_dir, consume_once_granted_dir,
)


def test_mode_default_ask(db_session, conversation):
    assert get_external_dir_mode(db_session, conversation.id) == "ask"


def test_set_mode(db_session, conversation):
    set_external_dir_mode(db_session, conversation.id, "auto")
    assert get_external_dir_mode(db_session, conversation.id) == "auto"


def test_session_granted_dirs(db_session, conversation):
    add_session_granted_dir(db_session, conversation.id, "/tmp/foo")
    assert "/tmp/foo" in get_session_granted_dirs(db_session, conversation.id)


def test_once_token_consumed(db_session, conversation):
    add_once_granted_dir(db_session, conversation.id, "/tmp/foo")
    assert consume_once_granted_dir(db_session, conversation.id, "/tmp/foo/x.txt") is True
    # 再消费同一前缀 → 已被移除
    assert consume_once_granted_dir(db_session, conversation.id, "/tmp/foo/y.txt") is False
```

（`conversation` fixture：若 conftest 无，仿 `test_destructive_hitl.py` 造一个挂在 `workspace` 下的 Conversation。）

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现 session_flags 辅助**

复用 `destructive_hitl.parse_session_flags` / `get_session_flags`，新增：

```python
# 追加到 path_authorization.py
import json
from sqlalchemy.orm import Session
from src.models.conversation import Conversation
from src.service.agent.destructive_hitl import parse_session_flags

VALID_MODES = {"ask", "auto", "deny"}


def _save_flags(db: Session, conversation_id: int, flags: dict) -> None:
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    conv.session_flags = json.dumps(flags, ensure_ascii=False) if flags else None
    db.add(conv)
    db.commit()


def get_external_dir_mode(db: Session, conversation_id: int) -> str:
    conv = db.get(Conversation, conversation_id)
    flags = parse_session_flags(conv.session_flags if conv else None)
    mode = flags.get("external_dir_mode")
    return mode if mode in VALID_MODES else "ask"


def set_external_dir_mode(db: Session, conversation_id: int, mode: str) -> None:
    if mode not in VALID_MODES:
        raise ValueError(f"invalid mode: {mode}")
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    flags = parse_session_flags(conv.session_flags)
    flags["external_dir_mode"] = mode
    _save_flags(db, conversation_id, flags)


def _add_dir(db, conversation_id, key, path):
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    flags = parse_session_flags(conv.session_flags)
    lst = flags.get(key, [])
    if path not in lst:
        lst.append(path)
    flags[key] = lst
    _save_flags(db, conversation_id, flags)


def add_session_granted_dir(db, conversation_id, path):
    _add_dir(db, conversation_id, "granted_dirs", path)


def get_session_granted_dirs(db, conversation_id) -> list[str]:
    conv = db.get(Conversation, conversation_id)
    return parse_session_flags(conv.session_flags if conv else None).get("granted_dirs", [])


def add_once_granted_dir(db, conversation_id, path):
    _add_dir(db, conversation_id, "once_granted_dirs", path)


def consume_once_granted_dir(db, conversation_id, target) -> bool:
    """target 命中某 once 令牌前缀 → 移除该令牌并返回 True。"""
    from pathlib import Path
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return False
    flags = parse_session_flags(conv.session_flags)
    tokens = flags.get("once_granted_dirs", [])
    t = Path(target).resolve()
    for tok in list(tokens):
        try:
            if t.is_relative_to(Path(tok).resolve()):
                tokens.remove(tok)
                flags["once_granted_dirs"] = tokens
                _save_flags(db, conversation_id, flags)
                return True
        except (OSError, ValueError):
            continue
    return False
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/agent/path_authorization.py tests/test_path_authorization_session_flags.py
git commit -m "feat: session_flags 授权辅助(mode/granted_dirs/once 令牌)"
```

### Task 5: is_granted 检查链 + record_grant

**Files:**
- Modify: `apps/server/src/service/agent/path_authorization.py`
- Test: `apps/server/tests/test_path_authorization_is_granted.py`

- [ ] **Step 1: 写失败测试**（覆盖 6 级短路）

```python
# tests/test_path_authorization_is_granted.py
from src.service.agent.path_authorization import is_granted, record_grant


def test_prefix_match_permanent(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/foo", "permanent")
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/foo/sub/x.txt") is True


def test_session_grant(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/bar", "session")
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/bar/x") is True


def test_auto_mode_grants_all(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/any", "auto")
    assert is_granted(db_session, workspace.id, conversation.id, "/somewhere/else") is True


def test_once_consumed(db_session, workspace, conversation):
    record_grant(db_session, workspace.id, conversation.id, "/tmp/once", "once")
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/once/x") is True
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/once/y") is False  # 一次性


def test_not_granted(db_session, workspace, conversation):
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/nope") is False
```

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现 is_granted + record_grant**

```python
# 追加到 path_authorization.py
from pathlib import Path
from src.models.workspace import Workspace
from src.service.authorized_dir_service import grant_dir, list_authorized_dirs


def _prefix_hit(target: str, dirs: list[str]) -> bool:
    t = Path(target).resolve()
    for d in dirs:
        try:
            if t.is_relative_to(Path(d).resolve()):
                return True
        except (OSError, ValueError):
            continue
    return False


def is_granted(db, workspace_id, conversation_id, target) -> bool:
    ws = db.get(Workspace, workspace_id)
    if ws and ws.auto_grant_external_dirs:
        return True
    if get_external_dir_mode(db, conversation_id) == "auto":
        return True
    if _prefix_hit(target, list_authorized_dirs(db, workspace_id)):
        return True
    if _prefix_hit(target, get_session_granted_dirs(db, conversation_id)):
        return True
    if consume_once_granted_dir(db, conversation_id, target):  # 命中即消费
        return True
    return False


def record_grant(db, workspace_id, conversation_id, path, scope) -> None:
    parent = str(Path(path).resolve())  # path 已是目录(请求工具传父目录)
    if scope == "permanent":
        grant_dir(db, workspace_id, parent)
    elif scope == "session":
        add_session_granted_dir(db, conversation_id, parent)
    elif scope == "auto":
        set_external_dir_mode(db, conversation_id, "auto")
    elif scope == "once":
        add_once_granted_dir(db, conversation_id, parent)
    else:
        raise ValueError(f"invalid scope: {scope}")
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/agent/path_authorization.py tests/test_path_authorization_is_granted.py
git commit -m "feat: is_granted 6级检查链 + record_grant 按scope落地"
```

### Task 6: guard_external_write

**Files:**
- Modify: `apps/server/src/service/agent/path_authorization.py`
- Test: `apps/server/tests/test_guard_external_write.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_guard_external_write.py
from pathlib import Path
from src.service.agent.path_authorization import guard_external_write


def _ctx(db_session, workspace, conversation, tmp_path):
    (tmp_path / "artifacts").mkdir(exist_ok=True)
    return dict(
        db=db_session, workspace_id=workspace.id, conversation_id=conversation.id,
        roots=[tmp_path / "artifacts"],
    )


def test_inside_returns_none(db_session, workspace, conversation, tmp_path):
    c = _ctx(db_session, workspace, conversation, tmp_path)
    assert guard_external_write(str(tmp_path / "artifacts" / "x.txt"), **c) is None


def test_deny_mode_rejects(db_session, workspace, conversation, tmp_path):
    from src.service.agent.path_authorization import set_external_dir_mode
    set_external_dir_mode(db_session, conversation.id, "deny")
    c = _ctx(db_session, workspace, conversation, tmp_path)
    msg = guard_external_write(str(tmp_path / "other" / "x.txt"), **c)
    assert msg and "严格" in msg


def test_ask_unauthorized_points_to_request_tool(db_session, workspace, conversation, tmp_path):
    c = _ctx(db_session, workspace, conversation, tmp_path)
    msg = guard_external_write(str(tmp_path / "other" / "x.txt"), **c)
    assert msg and "request_external_dir_access" in msg
```

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现 guard**

```python
# 追加到 path_authorization.py
def guard_external_write(target, *, db, workspace_id, conversation_id, roots) -> str | None:
    """返回 None=放行写；返回错误提示串=挡回(调用方转 error ToolMessage)。"""
    if not is_outside_workspace(target, roots):
        return None
    if is_granted(db, workspace_id, conversation_id, target):
        return None
    if get_external_dir_mode(db, conversation_id) == "deny":
        return f"严格模式：拒绝写入工作区外目录 {target}"
    parent = str(Path(target).resolve().parent)
    return (
        f"目标 {target} 在工作区外且未授权。请先调用 "
        f'request_external_dir_access(path="{parent}") 申请授权，获批后再写。'
    )
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/agent/path_authorization.py tests/test_guard_external_write.py
git commit -m "feat: guard_external_write 写守卫(返回提示串|None)"
```

---

## Phase 3 — 工具层接入（按 Task 0 spike 结论实现）

### Task 7: 覆盖 write_file / edit_file 接守卫

**Files:**
- Modify: `apps/server/src/service/agent/compatible_filesystem_middleware.py`
- Test: `apps/server/tests/test_write_file_guard_integration.py`
- 依据：Task 0 Spike 结论（覆盖点、write_file 签名、db 工厂）

- [ ] **Step 1: 写失败测试**（按 spike 确定的覆盖入口构造 middleware 实例 + ToolRuntime，断言越界写返回 error、工作区内写正常）。若直接构造困难，则测包装函数层：抽出 `apply_write_guard(target, guard_ctx, do_write)` 高阶函数，单测它（越界→error ToolMessage；放行→调 do_write）。

```python
# tests/test_write_file_guard_integration.py
from src.service.agent.compatible_filesystem_middleware import apply_write_guard


def test_guard_blocks_external(db_session, workspace, conversation, tmp_path):
    (tmp_path / "artifacts").mkdir()
    ctx = dict(db=db_session, workspace_id=workspace.id,
               conversation_id=conversation.id, roots=[tmp_path / "artifacts"])
    called = {"v": False}
    def do_write(): called["v"] = True; return "WROTE"
    res = apply_write_guard(str(tmp_path / "other" / "x"), ctx, do_write, tool_call_id="t1")
    assert called["v"] is False
    assert res.status == "error"


def test_guard_allows_inside(db_session, workspace, conversation, tmp_path):
    (tmp_path / "artifacts").mkdir()
    ctx = dict(db=db_session, workspace_id=workspace.id,
               conversation_id=conversation.id, roots=[tmp_path / "artifacts"])
    res = apply_write_guard(str(tmp_path / "artifacts" / "x"), ctx, lambda: "WROTE",
                            tool_call_id="t1")
    assert res == "WROTE"
```

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现 `apply_write_guard` + 覆盖 write_file/edit_file**

```python
# compatible_filesystem_middleware.py
from langchain_core.messages import ToolMessage
from src.service.agent.path_authorization import guard_external_write

def apply_write_guard(target, guard_ctx, do_write, *, tool_call_id):
    reason = guard_external_write(target, **guard_ctx)
    if reason is not None:
        return ToolMessage(content=reason, status="error", tool_call_id=tool_call_id)
    return do_write()
```

按 spike 结论，在子类 / 安装函数里覆盖 write_file、edit_file 工具：其 func/coroutine 先取 path 参数与注入的 `guard_ctx`（闭包，见 Task 8），调 `apply_write_guard(path, guard_ctx, lambda: <原始基类写>, tool_call_id=runtime.tool_call_id)`。`guard_ctx` 的 `db` 用注入的 db 工厂每次新开 session（`with db_factory() as db`），避免跨请求复用。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/agent/compatible_filesystem_middleware.py tests/test_write_file_guard_integration.py
git commit -m "feat: 覆盖 write_file/edit_file 接 apply_write_guard 写守卫"
```

### Task 8: request_external_dir_access 工具 + interrupt_on + employee 接线

**Files:**
- Create: `apps/server/src/service/agent/external_dir_request_tool.py`
- Modify: `apps/server/src/service/agent/hitl_interrupt_on.py`（合并新 interrupt_on）
- Modify: `apps/server/src/service/agent/employee.py`（注入 guard_ctx 闭包 + 挂工具 + 系统提示）
- Test: `apps/server/tests/test_external_dir_request_tool.py`
- 参考：`clarifying_questions_tool.py`、`destructive_hitl.py:23`、`hitl_interrupt_on.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_external_dir_request_tool.py
from src.service.agent.external_dir_request_tool import (
    REQUEST_EXTERNAL_DIR_TOOL_NAME, EXTERNAL_DIR_INTERRUPT_ON,
)


def test_tool_name_and_interrupt_registered():
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME == "request_external_dir_access"
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in EXTERNAL_DIR_INTERRUPT_ON
    assert "approve" in EXTERNAL_DIR_INTERRUPT_ON[REQUEST_EXTERNAL_DIR_TOOL_NAME]["allowed_decisions"]


def test_merged_into_hitl_interrupt_on():
    from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in HITL_INTERRUPT_ON
```

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现工具 + interrupt_on**

```python
# src/service/agent/external_dir_request_tool.py
REQUEST_EXTERNAL_DIR_TOOL_NAME = "request_external_dir_access"

EXTERNAL_DIR_INTERRUPT_ON = {
    REQUEST_EXTERNAL_DIR_TOOL_NAME: {"allowed_decisions": ["approve", "reject"]}
}


def build_request_external_dir_tool():
    from langchain_core.tools import StructuredTool

    def _run(path: str, reason: str = "") -> str:
        # resume 后返回：interrupt_on 在调用前挂起，approve handler 已按 scope 记授权
        return f"已处理对 {path} 的授权请求（以用户在卡片上的选择为准）。"

    return StructuredTool.from_function(
        name=REQUEST_EXTERNAL_DIR_TOOL_NAME,
        description=(
            "申请写入工作区外目录的授权。当 write_file/edit_file 因目标在工作区外被挡回时，"
            "用目标的父目录调用本工具，等待用户授权后再重试写入。"
        ),
        func=_run,
    )
```

在 `hitl_interrupt_on.py` 合并 `EXTERNAL_DIR_INTERRUPT_ON`（仿现有 `**CLARIFYING... **DOCUMENT_PLAN...` 风格）。

- [ ] **Step 4: employee.py 接线**（按 Task 0 结论）

- 在构造 agent 处，用作用域内的 `conversation_id`、`resolve_workspace_dirs(...)`、db 工厂构造 `guard_ctx`（传给 Task 7 覆盖的写工具闭包）。
- 把 `build_request_external_dir_tool()` 加入 agent 工具集。
- agent `interrupt_on` 经 `build_orchestrator_interrupt_on` 链路自动含新工具（因已并入 `HITL_INTERRUPT_ON`）；核对 employee 用的是该合并入口。
- 在员工系统提示追加一句："写工作区外目录前必须先调用 request_external_dir_access(path=父目录) 申请授权，获批后再写。"

- [ ] **Step 5: 跑测试确认通过** — Expected: PASS（工具/interrupt_on 单测）；employee 接线由 Phase 6 集成测试覆盖。

- [ ] **Step 6: Commit**

```bash
git add src/service/agent/external_dir_request_tool.py src/service/agent/hitl_interrupt_on.py src/service/agent/employee.py tests/test_external_dir_request_tool.py
git commit -m "feat: request_external_dir_access 工具+interrupt_on+employee接线(guard_ctx/系统提示)"
```

---

## Phase 4 — API（approve handler 记授权 + mode 端点）

### Task 9: /approve 处理 external_dir scope

**Files:**
- Modify: `apps/server/src/api/chat_api.py`（`ApproveRequest` 加 `external_dir`）
- Modify: `apps/server/src/service/chat_service.py`（`approve_trigger` 按 scope 记授权）
- Test: `apps/server/tests/test_approve_external_dir.py`
- 参考：`chat_api.py:393`（approve 端点）、`chat_service.py:1165-1204`（destructive_hitl 处理）

- [ ] **Step 1: 写失败测试**（service 层，绕过 HTTP）

```python
# tests/test_approve_external_dir.py
from src.service.agent.path_authorization import is_granted


def test_approve_permanent_records_grant(db_session, workspace, conversation):
    from src.service.chat_service import _apply_external_dir_grant  # 抽出的纯函数
    _apply_external_dir_grant(db_session, workspace.id, conversation.id,
                              {"path": "/tmp/foo", "scope": "permanent"})
    assert is_granted(db_session, workspace.id, conversation.id, "/tmp/foo/x") is True
```

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现**

- `ApproveRequest` 加 `external_dir: dict | None = None`（含 `path`、`scope`）。
- 抽出纯函数 `_apply_external_dir_grant(db, workspace_id, conversation_id, external_dir)` → 调 `record_grant`。
- 在 `approve_trigger` 中，resume `request_external_dir_access` 前：若 `external_dir` 且 decision 为 approve → 调 `_apply_external_dir_grant`（仿 `set_skip_destructive_hitl` 调用位置）。reject 不记。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/chat_api.py src/service/chat_service.py tests/test_approve_external_dir.py
git commit -m "feat: /approve 按 external_dir.scope 记授权"
```

### Task 10: external_dir_mode 读写端点

**Files:**
- Modify: `apps/server/src/api/chat_api.py`（新增端点）
- Test: `apps/server/tests/test_external_dir_mode_endpoint.py`

- [ ] **Step 1: 写失败测试**（用 FastAPI TestClient，仿现有 api 测试；或测 service 函数）。断言 PATCH 设 mode 后 `get_external_dir_mode` 返回新值。

- [ ] **Step 2: 跑测试确认失败** — FAIL

- [ ] **Step 3: 实现端点**

`PATCH /chat/conversations/{conversation_id}/external-dir-mode`，body `{mode: "ask"|"auto"|"deny"}` → 调 `set_external_dir_mode`；GET 同路径返回当前 mode（供前端药丸初始化）。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/chat_api.py tests/test_external_dir_mode_endpoint.py
git commit -m "feat: external_dir_mode GET/PATCH 端点"
```

---

## Phase 5 — 前端（卡片 + 药丸）

### Task 11: HITL kind 登记 external_dir_authorization

**Files:**
- Modify: `apps/web/src/lib/chat/hitl/constants.ts`、`apps/web/src/lib/chat/hitl/kind.ts`
- Test: `apps/web/src/lib/chat/hitl/kind.test.ts`（补用例）

- [ ] **Step 1: 补失败测试**

```typescript
it("maps request_external_dir_access to external_dir_authorization", () => {
  expect(hitlKindFromToolType("tool-request_external_dir_access"))
    .toBe("external_dir_authorization")
})
```

- [ ] **Step 2: 跑确认失败** — `cd apps/web && pnpm test:unit kind` → FAIL

- [ ] **Step 3: 实现**

- `constants.ts`：`export const EXTERNAL_DIR_TOOL_NAME = "request_external_dir_access"`，加入 `HITL_TOOL_NAMES`。
- `kind.ts`：`PendingHitlKind` 加 `"external_dir_authorization"`；`hitlKindFromToolType` 加 `if (type === \`tool-${EXTERNAL_DIR_TOOL_NAME}\`) return "external_dir_authorization"`。

- [ ] **Step 4: 跑确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/hitl/
git commit -m "feat(web): 登记 external_dir_authorization HITL kind"
```

### Task 12: 授权卡片 external-dir-auth-card

**Files:**
- Create: `apps/web/src/components/chat/message-blocks/external-dir-auth-card.tsx`
- Modify: `apps/web/src/components/chat/message-blocks/block-render-map.tsx`（加分发分支）
- Modify: `apps/web/src/components/chat/panel/chat-composer-area.tsx`（blocksComposer 加条件）
- Modify: `apps/web/src/api/conversation.ts`（`approveHitl` options 加 `external_dir`）
- 参考：`destructive-delete-confirm-card.tsx`

- [ ] **Step 1: 写失败测试**（卡片 5 按钮各调 approveHitl 带正确 scope）

```typescript
// external-dir-auth-card.test.tsx (@vitest-environment happy-dom)
// 渲染卡片，点「永久」→ 断言 approveHitl 收到 options.external_dir.scope === "permanent"
// 点「拒绝」→ decisions[0].type === "reject"
```

- [ ] **Step 2: 跑确认失败** — FAIL

- [ ] **Step 3: 实现卡片 + 分发 + 阻塞 + API options**

- `approveHitl` options 加 `external_dir?: { path: string; scope: "once"|"session"|"permanent"|"auto" }`，并入 POST body。
- `external-dir-auth-card.tsx`：从 `input.path` 取路径，5 按钮按 spec §4.5 表映射 `submitDecisions` + options。仿 destructive 卡片的 `submitting/resolved` 状态。
- `block-render-map.tsx`：加 `if (block.kind === "external_dir_authorization") return <ExternalDirAuthCard ... />`。
- `chat-composer-area.tsx`：`const externalDirActive = pendingHitl?.kind === "external_dir_authorization"`，并入 `blocksComposer`。

- [ ] **Step 4: 跑确认通过** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chat/ apps/web/src/api/conversation.ts
git commit -m "feat(web): 工作区外目录授权卡片(5档) + 分发/阻塞/approve options"
```

### Task 13: 输入框模式药丸 ExternalDirModePill

**Files:**
- Create: `apps/web/src/components/chat-prompt-input/external-dir-mode-pill.tsx`
- Create: `apps/web/src/hooks/use-external-dir-mode.ts`（TanStack Query 读写 mode）
- Modify: `apps/web/src/components/chat-prompt-input/chat-prompt-input.tsx`（挂药丸）
- Modify: `apps/web/src/api/conversation.ts`（getExternalDirMode/setExternalDirMode）
- 参考：`@workspace/ui/components/dropdown-menu`、`chat-prompt-input.tsx:96-117`

- [ ] **Step 1: 写失败测试**（hook：setMode 触发 PATCH；药丸渲染当前 mode + 切换调 mutation）

- [ ] **Step 2: 跑确认失败** — FAIL

- [ ] **Step 3: 实现**

- `api/conversation.ts`：`getExternalDirMode(convId)` GET、`setExternalDirMode(convId, mode)` PATCH。
- `use-external-dir-mode.ts`：`useQuery` 读 + `useMutation` 写（成功 invalidate）。
- `external-dir-mode-pill.tsx`：`DropdownMenu` + 三 `DropdownMenuItem`（询问/放行/严禁），当前项打勾；药丸显示「目录·询问/放行/严禁」。
- `chat-prompt-input.tsx`：在 `PromptInputFooter` 左侧 `PromptInputTools` 组（line ~97，附件菜单之后）插入 `<ExternalDirModePill conversationId={conversationId} />`。需把 conversationId 透传到该组件（已在 props）。

- [ ] **Step 4: 跑确认通过 + typecheck** — `pnpm test:unit` + `pnpm typecheck` PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chat-prompt-input/ apps/web/src/hooks/use-external-dir-mode.ts apps/web/src/api/conversation.ts
git commit -m "feat(web): composer 工作区外目录模式药丸(询问/放行/严禁)"
```

---

## Phase 6 — 端到端 + 回归

### Task 14: 后端端到端集成测试

**Files:**
- Test: `apps/server/tests/test_external_dir_e2e.py`

- [ ] **Step 1: 写集成测试**（尽量端到端，必要处 mock agent 执行）：
  - 越界写 → 守卫返回 error 提示含 `request_external_dir_access`。
  - 模拟 approve(`scope=permanent`, path) → `is_granted` 真 → 重试 `guard_external_write` 返回 None。
  - `scope=once` → 第一次放行、第二次又挡回。
  - `mode=deny` → 守卫直拒、不提示请求工具。
  - `mode=auto` / `workspace.auto_grant_external_dirs=True` → 守卫静默放行。

- [ ] **Step 2: 跑确认通过** — `uv run pytest tests/test_external_dir_e2e.py -v` PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_external_dir_e2e.py
git commit -m "test: 工作区外目录授权端到端流程"
```

### Task 15: 回归基线 + 文档

**Files:**
- Modify: `CLAUDE.md` 或相关架构文档（如有 HITL/安全章节，补一句本特性）

- [ ] **Step 1: 后端全量**

Run: `cd apps/server && uv run pytest -q`
Expected: 不新增 failed（基线参 MEMORY「686 passed / 现有 5 failed」，本特性测试全绿）。

- [ ] **Step 2: 前端 typecheck + vitest**

Run: `cd apps/web && pnpm typecheck && pnpm test:unit`
Expected: 不破基线。

- [ ] **Step 3: lint/format**

Run: `pnpm lint --filter=web && pnpm format`

- [ ] **Step 4: 验收对照 spec §8** 逐条手测要点（或在集成测试覆盖处打勾）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: 工作区外目录授权——回归基线确认 + 架构文档补注"
```

---

## 关键依赖与顺序

- **Task 0 是硬门**：spike 不通（覆盖写工具不可行 / 守卫内无法安全开 DB）→ 停止，回报用户重选机制。
- Phase 1-2 纯后端、可并行起步；Phase 3 依赖 Phase 2 + Task 0 结论；Phase 4 依赖 Phase 2-3；Phase 5 依赖 Phase 4 端点契约（mode 端点、approve options 字段名）；Phase 6 最后。
- **前后端契约对齐点**：`external_dir={path, scope}` 字段名、`scope` 取值集、mode 端点路径——后端 Task 9/10 定，前端 Task 12/13 必须一致。
