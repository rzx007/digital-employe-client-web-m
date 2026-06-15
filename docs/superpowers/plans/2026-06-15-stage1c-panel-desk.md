# 阶段 1C：artifact-panel 接共享桌 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：[总览](2026-06-15-orchestrator-centric-overview.md) 阶段1；手测发现的面板缺口（1A Task6 只改沙箱读根、未改面板扫描）。基底 `feat/orchestrator-centric`（含 1A+1B）。

**Goal:** 让前端 artifact-panel 在**总管会话**里显示共享桌（`orchestrator-desk/conv-<总管会话id>/`）的全队产物——目前面板扫的是旧员工级位置 `employee-orchestrator/artifacts/conv-<id>`，与真实产物落点不符故显示空。

**Architecture:** 改 `resource_service.resolve_workspace_context`：若该会话存在共享桌目录（组队派活过才有），把面板"产物"桶的扫描根 `conv_artifacts` 指向共享桌。`list_resources` 消费它即自动显示桌内容（`_scan_dir_flat` 递归，task-*/ 子目录与根文件都会列出）。最小、加性、is_dir 守卫；非总管会话/无桌会话零影响；群路径(room_dir 优先)不变。

**Tech Stack:** Python / SQLAlchemy / pytest（patched_task_mutations_db 夹具）。测试 `cd apps/server && uv run pytest tests/... -v`。

---

## 设计要点（实现前必读）

**根因**（手测坐实）：`resolve_workspace_context(root_path, conversation_id)`（resource_service.py:267-281）调 `resolve_workspace_dirs` 时**不传 `shared_workspace_root`**，故对总管会话算出 `conv_artifacts = employee-orchestrator/artifacts/conv-<id>`（旧位置），而真实产物在 `orchestrator-desk/conv-<id>`。`list_resources` 扫前者 → 面板空。

**修法**：`resolve_workspace_context` 末尾加 is_dir 守卫的桌重定向——**只重定向 `conv_artifacts`（产物桶），不动 `workspace_dir`**（避免"产物"和"工作空间全部"两个桶显示重复内容）：

```python
    conv_artifacts = ws.workspace_dir / f"conv-{conversation_id}"
    desk = Path(root_path) / "orchestrator-desk" / f"conv-{conversation_id}"
    if desk.is_dir():
        conv_artifacts = desk          # 总管会话：产物桶以共享桌为根
    return ws.workspace_dir, ws.public_root, conv_artifacts, room_dir
```

**关键事实（已核）**：
- `_scan_dir_flat`（:84-）**递归**：扫桌会列出根文件（sort.py/bubble.py）+ `task-*/` 子目录（嵌套其内文件）。
- `list_resources`（:362）`current = room_dir or conv_artifacts`：总管会话 room_dir 为 None → current = 桌。群会话 room_dir 非 None → 桌重定向不影响（且群会话无 orchestrator-desk/conv-<群id>）。
- `_resolve_employee_id_for_conversation`（:235）curator→"orchestrator"；is_dir 守卫天然只对真有桌的会话生效（只有总管会话跑过 get_orchestrator_agent 才建桌）。
- 桌路径拼接方式与 `_read_roots_with_desk`（:310-314）一致。

**范围限制**：
- 只做**总管会话**面板看桌。**被派成员会话**面板看桌（Q-D 反查）仍延后——成员非用户入口，不需要。
- **不动** workspace/public 桶语义、沙箱 `_read_roots`（1A Task6 已让预览/下载可读桌）。
- 桌内若有 `conv-*` 残留空目录（手测见 conv-486/487），本计划**不**特殊跳过（_scan_dir_flat 会列为空文件夹，无害）；其来源单独排查（见开放问题 O1），不阻塞本子块。

**文件结构**：
- 改：`apps/server/src/service/resource_service.py`（`resolve_workspace_context` 加 2 行桌重定向）
- 测：`apps/server/tests/test_resource_desk_listing.py`（新建）

---

## Task 1：resolve_workspace_context 产物桶接共享桌

**Files:**
- Modify: `apps/server/src/service/resource_service.py`（`resolve_workspace_context` ~L267-281）
- Test: `apps/server/tests/test_resource_desk_listing.py`（新建）

- [ ] **Step 1: 写失败测试**（新建测试文件；用 patched_task_mutations_db 让内部 get_session_local 指向测试库）

```python
"""1C：总管会话 artifact-panel 显示共享桌产物。"""
from pathlib import Path

from src.models.conversation import Conversation
from src.service.resource_service import ResourceService, resolve_workspace_context


def _curator_conv(db, ws_id) -> int:
    conv = Conversation(workspace_id=ws_id, target_type="curator", target_id=0, title="总管")
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv.id


def test_resolve_workspace_context_points_artifacts_to_desk(
    patched_task_mutations_db, db_session, workspace
):
    """总管会话存在共享桌时，conv_artifacts 指向桌。"""
    conv_id = _curator_conv(db_session, workspace.id)
    root = workspace.root_path
    desk = Path(root) / "orchestrator-desk" / f"conv-{conv_id}"
    desk.mkdir(parents=True, exist_ok=True)
    (desk / "sort.py").write_text("x", encoding="utf-8")

    workspace_dir, public_root, conv_artifacts, room_dir = resolve_workspace_context(
        root, conv_id
    )
    assert conv_artifacts == desk
    assert room_dir is None


def test_resolve_workspace_context_no_desk_unchanged(
    patched_task_mutations_db, db_session, workspace
):
    """无共享桌的会话：conv_artifacts 维持旧员工级位置（不受影响）。"""
    conv_id = _curator_conv(db_session, workspace.id)
    root = workspace.root_path
    _ws, _pub, conv_artifacts, _room = resolve_workspace_context(root, conv_id)
    # 没建桌 → 仍是 employee-orchestrator/artifacts/conv-<id>
    assert conv_artifacts == Path(root) / "employee-orchestrator" / "artifacts" / f"conv-{conv_id}"


def test_list_resources_shows_desk_artifacts(
    patched_task_mutations_db, db_session, workspace
):
    """端到端：总管会话 list_resources 的 artifacts 桶含桌内产物（含 task-*/ 嵌套）。"""
    conv_id = _curator_conv(db_session, workspace.id)
    root = workspace.root_path
    desk = Path(root) / "orchestrator-desk" / f"conv-{conv_id}"
    (desk / "task-47").mkdir(parents=True, exist_ok=True)
    (desk / "task-47" / "sort.py").write_text("x", encoding="utf-8")
    (desk / "bubble.py").write_text("y", encoding="utf-8")

    rl = ResourceService.list_resources(root, conv_id)
    # 扁平收集所有名字（含嵌套）
    names: set[str] = set()
    def _walk(entries):
        for e in entries:
            names.add(e.name)
            if getattr(e, "children", None):
                _walk(e.children)
    _walk(rl.artifacts)
    assert "bubble.py" in names      # 桌根文件
    assert "sort.py" in names        # task-47/ 内嵌套文件
```

> 注意：`ResourceEntry` 的子节点字段名以实际为准（`children`？读 `src/schemas/resource.py` 确认；上面 `_walk` 用 `getattr(e, "children", None)` 容错。若目录项不带 children 而是路径前缀展开，则改断言为"任一 entry.path 含 bubble.py/sort.py"）。`workspace` 夹具的 `root_path` 是 tempfile.mkdtemp，直接用。

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_resource_desk_listing.py -v`
Expected: `test_resolve_workspace_context_points_artifacts_to_desk` 与 `test_list_resources_shows_desk_artifacts` FAIL（conv_artifacts 仍是员工级、artifacts 桶不含桌文件）；`_no_desk_unchanged` 应 PASS。

- [ ] **Step 3: 最小实现**

`resource_service.py` 的 `resolve_workspace_context`（~L280）现有：
```python
    conv_artifacts = ws.workspace_dir / f"conv-{conversation_id}"
    return ws.workspace_dir, ws.public_root, conv_artifacts, room_dir
```
改为：
```python
    conv_artifacts = ws.workspace_dir / f"conv-{conversation_id}"
    # 总管共享桌：组队派活过的会话，面板"产物"桶以共享桌为根（与 agent 写产物落点一致）
    desk = Path(root_path) / "orchestrator-desk" / f"conv-{conversation_id}"
    if desk.is_dir():
        conv_artifacts = desk
    return ws.workspace_dir, ws.public_root, conv_artifacts, room_dir
```
（`Path` 已在文件顶部 import。不动 workspace_dir/public_root/room_dir。）

- [ ] **Step 4: 跑测试确认通过 + 回归资源测试**
Run: `cd apps/server && uv run pytest tests/test_resource_desk_listing.py -v`（3 绿）
然后：`cd apps/server && uv run pytest tests/ -k "resource or desk" -v`（无资源回归；预存失败用基线比对区分）
Expected: 全 PASS（除预存基线）

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/resource_service.py apps/server/tests/test_resource_desk_listing.py
git commit -m "feat(resource): 总管会话 artifact-panel 产物桶接共享桌"
```

---

## 收尾验证

- [ ] **全量后端**：`cd apps/server && uv run pytest tests/ -q`，仅预存基线失败、零新增回归（基线 = 阶段1B tip，`git worktree add` 比对）。
- [ ] **手测桩**：重测组队 → 总管会话打开 artifact-panel → 应能看到共享桌产物（sort.py/bubble.py + task-*/）。

---

## 开放问题

- **O1 桌内 conv-* 残留目录**：手测见 `orchestrator-desk/conv-484/` 下有 `conv-486`/`conv-487`（成员会话 id）空/残留目录，来源未明（1A 代码不创建它们，疑似 deepagents/某路径逻辑按 $WORKSPACE_DIR 拼建）。本计划不处理（_scan_dir_flat 列为空文件夹无害）。单独排查：起后端复现、看是哪段代码 mkdir 了 `desk/conv-<memberid>`，必要时阻止或在扫描时跳过 `conv-*`。
- **O2 被派成员会话面板看桌（Q-D）**：仍延后；成员非用户入口，按需再做。
- **O3 workspace 桶语义**：本计划只改 artifacts 桶。总管跨会话产物现分散在各 `orchestrator-desk/conv-*`，workspace 桶（员工级根）对总管已基本空；是否给总管一个"所有桌"聚合视图，后续按需。
