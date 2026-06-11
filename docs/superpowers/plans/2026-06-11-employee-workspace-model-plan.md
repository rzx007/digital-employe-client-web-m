# 员工工作空间模型 实现计划（W1-W4）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。Steps 用 `- [ ]`。

**Goal:** 产物从会话级升到员工级工作空间（按会话分子目录）+ 全局公共区（按来源 `shared/employee-<id>/conv-<cid>/` 分层），含跨员工共享、级联删除、批量管理。

**Architecture:** 新增纯函数 `resolve_workspace_dirs()` 统一解析 `$ARTIFACTS_DIR`(写当前会话)/`$WORKSPACE_DIR`(读自己全部)/`$PUBLIC_DIR`(写自己公共子区)/`$PUBLIC_ROOT`(读全部公共)/`$UPLOADS_DIR`；两个 agent 构造与 env 注入消费它；资源服务沙箱放宽到"读=自己工作空间+整 shared+房间，写=当前会话+自己公共子区+房间"；删会话级联删私有+公共子区；批量删除端点。

**Tech Stack:** Python 3.12 · deepagents · pytest · FastAPI · React/TS · vitest。

**Spec:** [2026-06-11-employee-workspace-model-design.md](../specs/2026-06-11-employee-workspace-model-design.md)

**前提:** 建立在已合并的"去虚拟路径→真实路径+env"之上（worktree 已 ff 到 dev-new）。

---

## 目录契约（全相位引用）

```
root = settings.artifacts_path
公共区根   $PUBLIC_ROOT  = root/shared
工作空间根 $WORKSPACE_DIR = root/employee-<owner>/artifacts        （owner = employee_id 或 "orchestrator" 或 "default"）
当前会话   $ARTIFACTS_DIR = $WORKSPACE_DIR/conv-<cid>   （房间上下文 = room 共享 dir）
本会话上传 $UPLOADS_DIR   = $WORKSPACE_DIR/conv-<cid>/uploads
自己公共区 $PUBLIC_DIR    = $PUBLIC_ROOT/employee-<owner>/conv-<cid>
无会话 cid 段用 "_scratch"
```

---

## Task W1.1：`resolve_workspace_dirs` 纯函数 + 测试

**Files:**
- Create: `apps/server/src/service/agent/workspace_paths.py`
- Test: `apps/server/tests/test_workspace_paths.py`

- [ ] **Step 1：写失败测试**

```python
# apps/server/tests/test_workspace_paths.py
from pathlib import Path
from src.service.agent.workspace_paths import resolve_workspace_dirs


def test_employee_conversation(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    assert d.workspace_dir == tmp_path / "employee-7" / "artifacts"
    assert d.artifacts_dir == tmp_path / "employee-7" / "artifacts" / "conv-42"
    assert d.uploads_dir == d.artifacts_dir / "uploads"
    assert d.public_root == tmp_path / "shared"
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "conv-42"


def test_room_member_writes_to_room_but_keeps_own_workspace(tmp_path):
    room = tmp_path / "room-3" / "artifacts"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        shared_artifacts_dir=str(room), base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == room                                   # 协作产出落房间
    assert d.workspace_dir == tmp_path / "employee-7" / "artifacts"  # 仍读自己
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "conv-42"


def test_orchestrator_owner(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id="orchestrator", conversation_id=9,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    assert d.workspace_dir == tmp_path / "employee-orchestrator" / "artifacts"
    assert d.public_dir == tmp_path / "shared" / "employee-orchestrator" / "conv-9"


def test_no_conversation_uses_scratch(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=None,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == tmp_path / "employee-7" / "artifacts" / "_scratch"
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "_scratch"


def test_no_root_path_falls_back_to_base(tmp_path):
    base = tmp_path / "svc"
    d = resolve_workspace_dirs(
        root_path=None, employee_id=None, conversation_id=None,
        shared_artifacts_dir=None, base_dir=base,
    )
    assert d.public_root == base / "shared"
    assert d.workspace_dir == base / "employee-default" / "artifacts"
```

- [ ] **Step 2：运行确认失败**

Run: `cd apps/server; uv run pytest tests/test_workspace_paths.py -q`
Expected: FAIL（模块不存在）。

- [ ] **Step 3：实现**

```python
# apps/server/src/service/agent/workspace_paths.py
"""员工工作空间目录解析（纯函数）。

产物升到员工级：workspace = root/employee-<owner>/artifacts，当前会话在其 conv-<cid> 子目录；
公共区按来源分层 root/shared/employee-<owner>/conv-<cid>，读面向整个 root/shared。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WorkspaceDirs:
    artifacts_dir: Path   # $ARTIFACTS_DIR 写当前会话产物（房间上下文=房间共享）
    workspace_dir: Path   # $WORKSPACE_DIR 员工工作空间根（读自己全部）
    uploads_dir: Path     # $UPLOADS_DIR
    public_dir: Path      # $PUBLIC_DIR 写自己公共子区
    public_root: Path     # $PUBLIC_ROOT 读全部公共


def _owner_token(employee_id: int | str | None) -> str:
    if employee_id is None or str(employee_id) == "":
        return "employee-default"
    return f"employee-{employee_id}"


def resolve_workspace_dirs(
    *,
    root_path: str | None,
    employee_id: int | str | None,
    conversation_id: int | None,
    shared_artifacts_dir: str | None,
    base_dir: Path,
) -> WorkspaceDirs:
    root = Path(root_path) if root_path else Path(base_dir)
    owner = _owner_token(employee_id)
    conv_seg = f"conv-{conversation_id}" if conversation_id else "_scratch"

    public_root = root / "shared"
    public_dir = public_root / owner / conv_seg
    workspace_dir = root / owner / "artifacts"
    conv_artifacts = workspace_dir / conv_seg

    if shared_artifacts_dir:
        artifacts_dir = Path(shared_artifacts_dir)
    else:
        artifacts_dir = conv_artifacts
    uploads_dir = conv_artifacts / "uploads"

    return WorkspaceDirs(
        artifacts_dir=artifacts_dir,
        workspace_dir=workspace_dir,
        uploads_dir=uploads_dir,
        public_dir=public_dir,
        public_root=public_root,
    )
```

- [ ] **Step 4：运行确认通过**

Run: `cd apps/server; uv run pytest tests/test_workspace_paths.py -q`
Expected: PASS（5）。

- [ ] **Step 5：Commit**

```bash
git add apps/server/src/service/agent/workspace_paths.py apps/server/tests/test_workspace_paths.py
git commit -m "feat(workspace): resolve_workspace_dirs 员工工作空间+公共区路径解析"
```

---

## Task W1.2：`SkillAwareShellBackend` 注入 WORKSPACE/PUBLIC env

**Files:**
- Modify: `apps/server/src/service/skill_shell_backend.py`（`__init__` 注入块 + 新增构造参数 `workspace_root`/`public_dir`/`public_root`）
- Test: `apps/server/tests/test_shell_env_inject.py`（扩充）

- [ ] **Step 1：扩充测试断言新 env**

在 `test_shell_env_inject.py` 的 `_backend` 增传 `workspace_root`/`public_dir`/`public_root`，并断言：
```python
    assert b._env["WORKSPACE_DIR"] == str((tmp_path / "ws").resolve())
    assert b._env["PUBLIC_DIR"] == str((tmp_path / "pub" / "self").resolve())
    assert b._env["PUBLIC_ROOT"] == str((tmp_path / "pub").resolve())
```
（`_backend` 构造时传 `workspace_root=tmp_path/"ws"`, `public_dir=tmp_path/"pub"/"self"`, `public_root=tmp_path/"pub"`。）

- [ ] **Step 2：运行确认失败**

Run: `cd apps/server; uv run pytest tests/test_shell_env_inject.py -q` → FAIL（KeyError WORKSPACE_DIR）。

- [ ] **Step 3：实现**

`__init__` 新增可选参数 `workspace_root: Path | None`、`public_dir: Path | None`、`public_root: Path | None`，存为 `self._workspace_root` 等（`.resolve()`），在现有 env 注入块后追加：
```python
        if self._workspace_root is not None:
            self._env["WORKSPACE_DIR"] = str(self._workspace_root)
        if self._public_dir is not None:
            self._env["PUBLIC_DIR"] = str(self._public_dir)
        if self._public_root is not None:
            self._env["PUBLIC_ROOT"] = str(self._public_root)
```

- [ ] **Step 4：运行确认通过** → PASS。

- [ ] **Step 5：Commit**
```bash
git add apps/server/src/service/skill_shell_backend.py apps/server/tests/test_shell_env_inject.py
git commit -m "feat(shell): 注入 WORKSPACE_DIR/PUBLIC_DIR/PUBLIC_ROOT env"
```

---

## Task W1.3：`employee.py` 用 resolve_workspace_dirs

**Files:** Modify `apps/server/src/service/agent/employee.py`（替换 115-138 的 artifacts/uploads 计算）；Test `tests/test_employee_agent_paths.py`（扩充构造断言）。

- [ ] **Step 1：扩充测试** —— 在 `test_agent_constructs_with_real_paths` 后加：构造 agent（employee_id=7、conversation_id=42、root_path=tmp）后，断言 `shell_backend._env["WORKSPACE_DIR"]` 含 `employee-7`、`PUBLIC_ROOT` 以 `shared` 结尾。（用 monkeypatch settings.artifacts_path = tmp_path。）

- [ ] **Step 2：运行确认失败。**

- [ ] **Step 3：实现** —— 替换 115-138 块为：
```python
    from src.service.agent.workspace_paths import resolve_workspace_dirs
    ws = resolve_workspace_dirs(
        root_path=root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        shared_artifacts_dir=shared_artifacts_dir,
        base_dir=base_dir,
    )
    artifacts_dir = ws.artifacts_dir
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    ws.workspace_dir.mkdir(parents=True, exist_ok=True)
    ws.public_root.mkdir(parents=True, exist_ok=True)
    ws.public_dir.mkdir(parents=True, exist_ok=True)

    draft_dir: Path | None = None
    has_draft_route = False
    if conversation_id and root_path:
        draft_dir = ws.workspace_dir / f"conv-{conversation_id}" / "skills-draft"
        draft_dir.mkdir(parents=True, exist_ok=True)
        has_draft_route = True

    uploads_dir: Path | None = None
    if conversation_id and root_path:
        uploads_dir = ws.uploads_dir
        uploads_dir.mkdir(parents=True, exist_ok=True)
```
并把 `SkillAwareShellBackend(...)` 调用增参：`workspace_root=ws.workspace_dir, public_dir=ws.public_dir, public_root=ws.public_root`。
（history 计算保持；`skills-draft` 移到会话子目录下与产物同级。）

- [ ] **Step 4：运行确认通过 + 构造冒烟。**

- [ ] **Step 5：Commit**
```bash
git add apps/server/src/service/agent/employee.py apps/server/tests/test_employee_agent_paths.py
git commit -m "refactor(employee): 产物用员工工作空间(resolve_workspace_dirs)+公共区"
```

---

## Task W1.4：`orchestrator/agent.py` 同步（owner="orchestrator"）

**Files:** Modify `apps/server/src/service/agent/orchestrator/agent.py`（169-217 的 artifacts/uploads/conversation_dir 块）；Test `tests/test_orchestrator_agent_paths.py`。

- [ ] **Step 1-2:** 测试断言总管构造后 `shell_backend._env["WORKSPACE_DIR"]` 含 `employee-orchestrator`；先失败。
- [ ] **Step 3:** 用 `resolve_workspace_dirs(root_path=str(artifacts_path), employee_id="orchestrator", conversation_id=conversation_id, shared_artifacts_dir=shared_artifacts_dir, base_dir=base_dir)` 替换 artifacts_dir/uploads_dir 计算；`SkillAwareShellBackend` 增 workspace/public 参数。保留 conversation_dir（history）。
- [ ] **Step 4-5:** 通过 + commit `refactor(orchestrator): 产物用工作空间+公共区(owner=orchestrator)`。

---

## Task W1.5：prompt 增"工作空间/公共区"三句

**Files:** Modify `path_access/prompt_rules.py`(`build_file_tool_rules`)、`prompts.py`(`build_filesystem_prompt_section` 的目录表与正文)、`AGENTS.md`；Test `tests/test_filesystem_prompt_physical.py`。

- [ ] **Step 1:** 测试断言 prompt 含 `$WORKSPACE_DIR`、`$PUBLIC_DIR`、`$PUBLIC_ROOT` 字样且仍无虚拟前缀；先失败。
- [ ] **Step 2-3:** 在文件工具一节按 spec §5 加三句：
  - 找自己过去：`$WORKSPACE_DIR` 下按 `conv-*` 翻；
  - 共享：写 `$PUBLIC_DIR`（随会话/你删除自动清理）；
  - 取用：读 `$PUBLIC_ROOT`（所有人共享，按 employee-*/conv-* 分）。
  `build_filesystem_prompt_section` 目录表加 `$WORKSPACE_DIR`/`$PUBLIC_DIR`/`$PUBLIC_ROOT` 行。AGENTS.md 路径模式节同步。
- [ ] **Step 4-5:** 通过 + commit `docs(prompt): 增工作空间/公共区指引`。

---

## Task W1.6：W1 回归

- [ ] Run: `cd apps/server; uv run pytest tests/test_workspace_paths.py tests/test_shell_env_inject.py tests/test_employee_agent_paths.py tests/test_orchestrator_agent_paths.py tests/test_filesystem_prompt_physical.py -q` → 全 PASS。
- [ ] Run 全后端 `uv run pytest -q`，记录失败（应仅既存 3 个 + 资源相关待 W2）。
- [ ] Commit（若有 recap/doc 更新）。

---

## W2：资源服务 + API + 删除（任务级，执行时细化为 TDD）

**Files:** `resource_service.py`、`api/chat_api.py`、`schemas/resource.py`、`service/chat_service.py`。

- **W2.1 沙箱放宽**：`_resolve_safe_path`/`_bucket_of`/`_resolve_conversation_dir` → 按"读根集（员工工作空间 + 整 shared + 房间）/写根集（当前会话 + 自己 shared 子区 + 房间）"。新增 `resolve_employee_workspace_root(root, employee_id)` 与 allowed-roots 校验。测试：B 读不到 A 私有、能读 shared；写只限自己子区。
- **W2.2 list_resources 增字段**：`ResourceList` 加 `workspace`(员工全树按 conv 分)、`public`(shared/** 拍平带来源标签)。`schemas/resource.py` 加字段；`_scan_*` 复用。`bucket` 增 `workspace`/`public`。需 employee_id 入参（由会话→员工映射解析）。
- **W2.3 批量删产物端点**：`POST /chat/conversations/{id}/resources/batch-delete` 收 `{paths:[...]}`，逐条 §4 写沙箱校验，删（文件 unlink/目录 rmtree），返回 `{deleted,skipped}`。激活 stub 同 test_resource_static。
- **W2.4 删会话级联**：`ChatService.delete_conversation`/`adelete_conversations_by_target` 增 `cascade_artifacts: bool`；按会话→员工解析 `employee-<id>/artifacts/conv-<cid>/` 与 `shared/employee-<id>/conv-<cid>/` 两处删除。端点加 query `cascade`（默认 true）。测试：级联两路径 / 保留两路径。
- **W2.5 删员工级联**：解雇员工时删 `employee-<id>/artifacts/` 与 `shared/employee-<id>/`（在 employee 删除服务处）。

## W3：前端（任务级）

**Files:** `pending-resources/paths.ts`、`merge.ts`、`artifact-panel.tsx`、`api/conversation.ts`、会话列表组件。

- **W3.1** `getResourceBucket` 段匹配增 `workspace`/`public`（识别 `shared/`、`employee-*/artifacts` 段）。
- **W3.2** `artifact-panel` 增「工作空间全部」「公共区」折叠区，消费 `ResourceList.workspace/public`。
- **W3.3** 产物多选 + 批量删 UI（调 batch-delete 端点；公共区项二次确认"影响所有员工"）。
- **W3.4** 会话列表多选 + 批量删 + 级联确认框（删会话/删会话+产物）。
- 验证：`pnpm typecheck` + vitest（browser-store/paths/merge 相关）。

## W4：迁移（任务级）

- **W4.1** 资源解析惰性兼容：员工工作空间下找不到 `conv-<cid>/` 时，只读回退旧 `root/<conversation_id>/artifacts/`。`_resolve_conversation_dir` 加回退分支 + 测试。

---

## Self-Review（对照 spec）

- §2/§2.1 目录+env：W1.1/W1.2。✓
- §3 各上下文解析：W1.1（room/orchestrator/scratch 用例）+ W1.3/W1.4。✓
- §4 沙箱读写根：W2.1。✓
- §5 prompt：W1.5。✓
- §6 list 字段+工作台：W2.2 + W3.2。✓
- §7 删除（级联/保留/批量/越权）：W2.3/W2.4/W2.5 + W3.3/W3.4。✓
- §8 迁移惰性：W4.1。✓
- 开放问题暂定默认（Q1 惰性/Q3 总管独立/Q4 不自动/Q5 私有不互读/Q6 默认当前会话/Q8 不单独孤立视图）均按 spec 落地。

## 风险

- room 上下文 uploads/skills-draft 位置变化：W1.3 把它们移到工作空间会话子目录；需确认 resource_service uploads 解析同步（W2）。
- 会话→员工映射：删会话级联与 list_resources 需要它；DB 有 `Conversation.target_id`（employee）/room 映射，W2 复用 `_resolve_room_id_for_conversation` 旁加 `_resolve_employee_id_for_conversation`。
