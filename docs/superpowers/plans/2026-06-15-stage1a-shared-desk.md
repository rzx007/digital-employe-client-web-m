# 阶段 1A：共享桌回收（shared desk collapse）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 上游：[总览/排序计划](2026-06-15-orchestrator-centric-overview.md) 阶段 1 第①子块。基底分支 `feat/orchestrator-centric`（纯 dev）。

**Goal:** 把"组队"时总管与所有被派员工的工作产物，从各自的员工级目录（`employee-<id>/artifacts/conv-<cid>`）回收到**单一共享桌**（按总管会话隔离的 `orchestrator-desk/conv-<orchConvId>/`，子任务各占 `task-<taskId>/` 子目录），实现"全队读同一张桌、写各自子目录、互相看得见产物"。私有脑（技能/记忆）保持员工级不动。

**Architecture:** 复用现有 `shared_artifacts_dir` 重定向机制（群成员共享 `room-<id>/artifacts` 同一招），**新增一个"共享桌只读根"维度**：被派员工 `$ARTIFACTS_DIR`（写）= 桌的 `task-<id>/` 子目录、`$WORKSPACE_DIR`（读）= 桌根。改动加性、不碰流式、不动私有脑、群房间路径行为不变。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / pytest（内存 SQLite，无 Alembic，模型 create_all）。

---

## 设计要点（实现前必读）

**当前**（`workspace_paths.py:27-57`）：`resolve_workspace_dirs` 按 `employee_id` 算 `owner`，`artifacts_dir=employee-<id>/artifacts/conv-<cid>`、`workspace_dir=employee-<id>/artifacts`。群模式传 `shared_artifacts_dir` 只重定向 `artifacts_dir`（写房间），`workspace_dir` 仍是员工自己（读自己）。

**目标**：再加一个**只读根重定向**。引入新可选参数 `shared_workspace_root`：
- 传了 → `workspace_dir = shared_workspace_root`（读整张桌，看得见兄弟产物）。
- 没传 → 维持现状（读员工自己）。群模式不传它 → 行为字节级不变。

> **命名说明**：spec §5 写的是 `orchestrator-workspace/`（无会话隔离）；本计划采纳 Q-A"按总管会话隔离"，目录名定为 `orchestrator-desk/conv-<orchConvId>/`。后续阶段/读 spec 的人以本计划为准。

**共享桌路径**（按总管会话隔离）：`<root>/orchestrator-desk/conv-<orchConvId>/`
- 总管自己：`$ARTIFACTS_DIR = $WORKSPACE_DIR = 桌根`。
- 被派员工：`$ARTIFACTS_DIR = 桌根/task-<taskId>/`（写自己子目录，防撞名）、`$WORKSPACE_DIR = 桌根`（读整张桌）。

**私有脑不动**：`skills_root` / `memories_root` 仍按员工解析（学习闭环的家）。本计划不碰它们。

**public 区暂不动**：`public_dir`/`public_root` 维持现状（旧的跨员工共享机制）。它在新模型里被共享桌取代，但删它属阶段 4 退场，本计划不碰，避免 blast radius。

**文件结构**：
- 改：`apps/server/src/service/agent/workspace_paths.py`（加 `shared_workspace_root` 参数 + 新 helper `resolve_orchestrator_desk_dir`）
- 改：`apps/server/src/service/agent/employee.py`（`get_agent` 接 `shared_workspace_root` 透传 backend）
- 改：`apps/server/src/service/agent/orchestrator/agent.py`（`get_orchestrator_agent` 用共享桌）
- 改：`apps/server/src/service/agent/orchestrator/execution.py`（`start_task_as_conversation` 派活传桌）
- 改：`apps/server/src/service/resource_service.py`（沙箱读根含共享桌——让资源面板/预览能读到桌）
- 测：`tests/test_workspace_paths.py`、`tests/test_shell_env_inject.py`、新增 `tests/test_orchestrator_desk.py`

---

## Task 1：`resolve_workspace_dirs` 支持共享桌只读根

**Files:**
- Modify: `apps/server/src/service/agent/workspace_paths.py:27-57`
- Test: `apps/server/tests/test_workspace_paths.py`

- [ ] **Step 1: 写失败测试**（追加到 `test_workspace_paths.py` 末尾）

```python
def test_shared_workspace_root_redirects_read_root(tmp_path):
    """传 shared_workspace_root → workspace_dir 指向共享桌根（读整张桌）；
    artifacts_dir 仍由 shared_artifacts_dir 控制（写自己子目录）。"""
    desk = tmp_path / "orchestrator-desk" / "conv-9"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,
        shared_artifacts_dir=str(desk / "task-100"),
        shared_workspace_root=desk,
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == desk / "task-100"   # 写自己子目录
    assert d.workspace_dir == desk                # 读整张桌
    # 私有脑相关不受影响（public 维持旧语义）
    assert d.public_root == tmp_path / "shared"


def test_shared_workspace_root_absent_keeps_own(tmp_path):
    """不传 shared_workspace_root → workspace_dir 仍是员工自己（群模式行为不变）。"""
    room = tmp_path / "room-3" / "artifacts"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,
        shared_artifacts_dir=str(room),
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == room
    assert d.workspace_dir == tmp_path / "employee-7" / "artifacts"  # 维持现状
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pytest apps/server/tests/test_workspace_paths.py::test_shared_workspace_root_redirects_read_root -v`
Expected: FAIL（`resolve_workspace_dirs() got an unexpected keyword argument 'shared_workspace_root'`）

- [ ] **Step 3: 最小实现**

在 `workspace_paths.py` 的 `resolve_workspace_dirs` 签名加参数（在 `shared_artifacts_dir` 后、`base_dir` 前）：

```python
def resolve_workspace_dirs(
    *,
    root_path: str | None,
    employee_id: int | str | None,
    conversation_id: int | None,
    shared_artifacts_dir: str | None,
    shared_workspace_root: Path | None = None,   # 新增：共享桌只读根
    base_dir: Path,
) -> WorkspaceDirs:
```

`workspace_paths.py` 现有代码（`:42-43`）是：
```python
    workspace_dir = root / owner / "artifacts"
    conv_artifacts = workspace_dir / conv_seg
```
**⚠️ 必须把这两行整体替换**为下面版本（不是在前面插入——否则重定向后 `conv_artifacts` 会跟着指到桌、污染 uploads 落点）：

```python
    workspace_dir = root / owner / "artifacts"
    conv_artifacts = workspace_dir / conv_seg          # uploads/会话私有，恒按员工算（先于重定向定下）
    if shared_workspace_root is not None:
        workspace_dir = Path(shared_workspace_root)    # 只改读根为共享桌，不动 conv_artifacts
```

> 关键顺序：先用员工目录算定 `conv_artifacts`（uploads 落点不随桌走，上传是会话输入），**再**重定向 `workspace_dir`。`artifacts_dir` 的重定向逻辑（`shared_artifacts_dir` 优先）保持原样。

- [ ] **Step 4: 跑测试确认通过**

Run: `pytest apps/server/tests/test_workspace_paths.py -v`
Expected: 全 PASS（新增 2 个 + 原有全部不回归）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/workspace_paths.py apps/server/tests/test_workspace_paths.py
git commit -m "feat(workspace): resolve_workspace_dirs 支持 shared_workspace_root 共享桌只读根"
```

---

## Task 2：新增 `resolve_orchestrator_desk_dir` helper

**Files:**
- Modify: `apps/server/src/service/agent/workspace_paths.py`（文件末尾加函数）
- Test: `apps/server/tests/test_workspace_paths.py`

- [ ] **Step 1: 写失败测试**

```python
def test_resolve_orchestrator_desk_dir(tmp_path):
    """共享桌按总管会话隔离，路径 = <root>/orchestrator-desk/conv-<orchConvId>，并 mkdir。"""
    from src.service.agent.workspace_paths import resolve_orchestrator_desk_dir
    desk = resolve_orchestrator_desk_dir(str(tmp_path), 9)
    assert desk == tmp_path / "orchestrator-desk" / "conv-9"
    assert desk.is_dir()


def test_orchestrator_task_subdir(tmp_path):
    """子任务写子目录 = 桌根/task-<taskId>。"""
    from src.service.agent.workspace_paths import (
        resolve_orchestrator_desk_dir,
        orchestrator_task_subdir,
    )
    desk = resolve_orchestrator_desk_dir(str(tmp_path), 9)
    sub = orchestrator_task_subdir(desk, 100)
    assert sub == desk / "task-100"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pytest apps/server/tests/test_workspace_paths.py::test_resolve_orchestrator_desk_dir -v`
Expected: FAIL（ImportError: cannot import name 'resolve_orchestrator_desk_dir'）

- [ ] **Step 3: 最小实现**（追加到 `workspace_paths.py` 末尾）

```python
def resolve_orchestrator_desk_dir(root_path: str, orchestrator_conversation_id: int) -> Path:
    """总管共享桌根，按总管会话隔离。全队（总管 + 被派员工）共享这一张桌。"""
    desk = Path(root_path) / "orchestrator-desk" / f"conv-{orchestrator_conversation_id}"
    desk.mkdir(parents=True, exist_ok=True)
    return desk


def orchestrator_task_subdir(desk_dir: Path, task_id: int) -> Path:
    """某子任务在共享桌内的写子目录（防撞名）。"""
    return desk_dir / f"task-{task_id}"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pytest apps/server/tests/test_workspace_paths.py -v`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/workspace_paths.py apps/server/tests/test_workspace_paths.py
git commit -m "feat(workspace): 新增 resolve_orchestrator_desk_dir/orchestrator_task_subdir 共享桌路径"
```

---

## Task 3：`get_agent` 接受并透传 `shared_workspace_root`

**Files:**
- Modify: `apps/server/src/service/agent/employee.py:55`（签名）、`:133-146`（解析）、`:175-191`（backend）
- Test: `apps/server/tests/test_shell_env_inject.py`（验证 env 链路已有样板）+ 新增 backend env 断言

- [ ] **Step 1: 写失败测试**（追加到 `test_shell_env_inject.py`）

```python
def test_backend_workspace_root_points_to_shared_desk(tmp_path):
    """backend 收到共享桌只读根时，注入的 WORKSPACE_DIR = 桌根。"""
    skills = tmp_path / "skills"; skills.mkdir()
    artifacts = tmp_path / "desk" / "task-100"; artifacts.mkdir(parents=True)
    desk = tmp_path / "desk"
    b = SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=skills,
        draft_root=None,
        workspace_root=desk,          # 共享桌根
        conversation_id=42,
        virtual_mode=False,
    )
    assert b._env["ARTIFACTS_DIR"] == str(artifacts.resolve())
    assert b._env["WORKSPACE_DIR"] == str(desk.resolve())
```

> backend 本身已支持 `workspace_root`（`skill_shell_backend.py:160-199` 已注入 `WORKSPACE_DIR`），此测试锁定"桌根能正确流到 env"。真正改动在 `get_agent` 把 `shared_workspace_root` 透传进来。

- [ ] **Step 2: 跑测试确认通过（backend 层已支持）**

Run: `pytest apps/server/tests/test_shell_env_inject.py::test_backend_workspace_root_points_to_shared_desk -v`
Expected: PASS（确认 backend 已具备能力；本测试是回归护栏）

- [ ] **Step 3: 改 `get_agent` 透传**

`employee.py:55` 签名加参数（在 `shared_artifacts_dir` 后）：
```python
    shared_artifacts_dir: str | None = None,
    shared_workspace_root: str | None = None,   # 新增：共享桌只读根
```

`employee.py:133-146` 解析处把它传进 `resolve_workspace_dirs`：
```python
    ws = resolve_workspace_dirs(
        root_path=root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        shared_artifacts_dir=shared_artifacts_dir,
        shared_workspace_root=Path(shared_workspace_root) if shared_workspace_root else None,
        base_dir=base_dir,
    )
```

（`:175-191` 的 backend 构造已用 `ws.workspace_dir`，无需再改。）

- [ ] **Step 4: 回归全相关测试**

Run: `pytest apps/server/tests/test_shell_env_inject.py apps/server/tests/test_workspace_paths.py -v`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/employee.py apps/server/tests/test_shell_env_inject.py
git commit -m "feat(agent): get_agent 透传 shared_workspace_root 到 backend"
```

---

## Task 4：派活时把共享桌喂给被派员工

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/execution.py:420`（解析桌）、`:439-446`（传 get_agent）
- Test: 新增 `apps/server/tests/test_orchestrator_desk.py`

- [ ] **Step 1: 写失败测试**（新建文件）

```python
from pathlib import Path
from src.service.agent.workspace_paths import (
    resolve_orchestrator_desk_dir,
    orchestrator_task_subdir,
    resolve_workspace_dirs,
)


def test_dispatched_employee_shares_desk(tmp_path):
    """被派员工：写桌的 task 子目录、读整张桌。"""
    orch_conv_id = 9
    task_id = 100
    desk = resolve_orchestrator_desk_dir(str(tmp_path), orch_conv_id)
    sub = orchestrator_task_subdir(desk, task_id)
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,                 # 成员执行会话
        shared_artifacts_dir=str(sub),
        shared_workspace_root=desk,
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == desk / "task-100"
    assert d.workspace_dir == desk
```

- [ ] **Step 2: 跑测试确认通过（纯路径，验证设计自洽）**

Run: `pytest apps/server/tests/test_orchestrator_desk.py -v`
Expected: PASS（这是设计自洽性测试；下一步把它接进 execution.py 真实派活）

- [ ] **Step 3: 改 `start_task_as_conversation` 派活传桌**

`execution.py:420` 在 `shared_artifacts_dir = _resolve_room_shared_artifacts_dir(...)` 之后加：群房间优先；非群则用总管共享桌。

```python
    shared_artifacts_dir = _resolve_room_shared_artifacts_dir(db, orch_conv_id, root_path)
    shared_workspace_root = None
    # 注：orch_conv_id 为 None 的孤儿任务（无 source_conversation_id 且无 plan）→ 不进桌，
    #     回落到员工级目录（现状行为），这是预期分支不是遗漏。
    if shared_artifacts_dir is None and orch_conv_id is not None:
        # 非群派活：全队共享总管这一张桌
        from src.service.agent.workspace_paths import (
            resolve_orchestrator_desk_dir,
            orchestrator_task_subdir,
        )
        _desk = resolve_orchestrator_desk_dir(root_path, orch_conv_id)
        shared_artifacts_dir = str(orchestrator_task_subdir(_desk, task.id))
        shared_workspace_root = str(_desk)
```

`execution.py:439-446` 传 `get_agent`：
```python
    agent = get_agent(
        skills_path,
        root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        enable_hitl=False,
        shared_artifacts_dir=shared_artifacts_dir,
        shared_workspace_root=shared_workspace_root,   # 新增
        max_output_tokens=resolve_output_tokens(_task_output_tier),
    )
```

- [ ] **Step 4: 回归**

Run: `pytest apps/server/tests/test_orchestrator_desk.py apps/server/tests/ -k "workspace or desk or shell_env" -v`
Expected: 全 PASS，无群相关回归

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/execution.py apps/server/tests/test_orchestrator_desk.py
git commit -m "feat(orchestrator): 非群派活让全队共享总管单一工作桌"
```

---

## Task 5：总管自己也用共享桌

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/agent.py:184-198`（解析）
- Test: `apps/server/tests/test_orchestrator_desk.py`

- [ ] **Step 1: 写失败测试**（追加）

```python
def test_orchestrator_uses_desk_root(tmp_path):
    """总管自己：artifacts 与 workspace 都指向桌根（与被派员工同桌）。"""
    desk = resolve_orchestrator_desk_dir(str(tmp_path), 9)
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id="orchestrator",
        conversation_id=9,
        shared_artifacts_dir=str(desk),       # 总管写桌根
        shared_workspace_root=desk,           # 总管读桌根
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == desk
    assert d.workspace_dir == desk
```

- [ ] **Step 2: 跑测试确认通过（纯路径）**

Run: `pytest apps/server/tests/test_orchestrator_desk.py::test_orchestrator_uses_desk_root -v`
Expected: PASS

- [ ] **Step 3: 改 `get_orchestrator_agent` 用桌**

`agent.py:184-198` 在 `resolve_workspace_dirs` 调用前，当有 `conversation_id` 时算桌并传：
```python
    _shared_artifacts_dir = shared_artifacts_dir
    _shared_workspace_root = None
    if shared_artifacts_dir is None and conversation_id is not None:
        from src.service.agent.workspace_paths import resolve_orchestrator_desk_dir
        _desk = resolve_orchestrator_desk_dir(str(artifacts_path), conversation_id)
        _shared_artifacts_dir = str(_desk)
        _shared_workspace_root = _desk
    ws = resolve_workspace_dirs(
        root_path=str(artifacts_path),
        employee_id="orchestrator",
        conversation_id=conversation_id,
        shared_artifacts_dir=_shared_artifacts_dir,
        shared_workspace_root=_shared_workspace_root,
        base_dir=base_dir,
    )
```

- [ ] **Step 4: 回归**

Run: `pytest apps/server/tests/test_orchestrator_desk.py -v`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/agent.py apps/server/tests/test_orchestrator_desk.py
git commit -m "feat(orchestrator): 总管自身工作目录指向同一共享桌"
```

---

## Task 6：沙箱/资源面板读根含共享桌

**Files:**
- Modify: `apps/server/src/service/resource_service.py:284-299`（`_read_roots`）
- Test: `apps/server/tests/test_orchestrator_desk.py`（沙箱读根断言）

> 目的：资源面板/预览/下载能读到共享桌的产物（"全队互见"在 UI 也成立）。Agent 写桌靠 shell backend（Task 3/4 已通），本任务补的是**只读 API 沙箱**。

- [ ] **Step 1: 写失败测试**

```python
def test_read_roots_include_orchestrator_desk(tmp_path, monkeypatch):
    """总管会话/被派会话的资源读根应包含其共享桌。"""
    from src.service import resource_service
    # 桌内放一个产物
    desk = resolve_orchestrator_desk_dir(str(tmp_path), 9)
    (desk / "task-100").mkdir(parents=True, exist_ok=True)
    (desk / "task-100" / "report.md").write_text("ok", encoding="utf-8")

    roots = resource_service._read_roots_with_desk(str(tmp_path), conversation_id=9, orchestrator_conversation_id=9)
    assert any(desk.resolve() == r or desk.resolve() in r.parents or r == desk.resolve() for r in roots)
```

> 实现期：`_read_roots` 现按 `conversation_id` 解析（`:284-299`）。最小侵入做法是抽一个 `_read_roots_with_desk(root_path, conversation_id, orchestrator_conversation_id)`，在原 roots 上追加 `resolve_orchestrator_desk_dir(root_path, orchestrator_conversation_id)`，原 `_read_roots` 调它（orchestrator_conversation_id 由会话反查，普通会话为 None 时不加）。具体反查复用 `_resolve_*_for_conversation` 既有模式；若反查成本高，可先只在总管会话直接 conv==orchConv 场景加桌（被派会话的桌可见性留 Task 6b/下一相位）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pytest apps/server/tests/test_orchestrator_desk.py::test_read_roots_include_orchestrator_desk -v`
Expected: FAIL（AttributeError: `_read_roots_with_desk`）

- [ ] **Step 3: 最小实现**

在 `resource_service.py` 抽出/新增 `_read_roots_with_desk`，把共享桌追加进读根；`_read_roots` 委托它（总管会话 orchestrator_conversation_id=conversation_id）。保留旧 legacy 回退分支。

- [ ] **Step 4: 跑测试 + 回归资源测试**

Run: `pytest apps/server/tests/ -k "resource or desk" -v`
Expected: 全 PASS，无资源沙箱回归

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/resource_service.py apps/server/tests/test_orchestrator_desk.py
git commit -m "feat(resource): 沙箱读根纳入总管共享桌，资源面板可见全队产物"
```

---

## 收尾验证

- [ ] **全量后端测试**

Run: `pytest apps/server/tests/ -q`
Expected: 仅预存基线失败（见记忆：test_prompt_invariants GBK / test_agent_runtime_policy / test_orchestrator_execution_summary 等），**零新增回归**。用 `git stash` 在干净基线比对存疑失败。

- [ ] **手测桩**（端到端待阶段 1 全子块齐后做）：本计划只保证"路径/沙箱"层正确；真正"组队后全队同桌互见产物"的端到端手测，留到再入整合协调器（阶段 1 第②子块）接上后一起验。

---

## 开放问题（实现时定夺）

- **Q-A 共享桌粒度**：按总管会话隔离（`conv-<orchConvId>`，本计划采用）vs 全局单桌。采用前者：不同对话不互相污染、删会话可级联清桌。
- **Q-B uploads 落点**：本计划让 uploads 仍按员工会话（不进桌），因上传是会话输入。若希望上传也进桌，后续调整。
- **Q-C public 区去留**：本计划不动 public（阶段 4 退场再删）。共享桌已实质取代 public 的跨员工共享作用。
- **Q-D 被派会话资源可见性**：Task 6 优先保总管会话直接可见桌；被派员工会话在资源面板看桌的反查，若成本高可放下一相位。
</content>
