# 产物收集重构(资源管理器为权威 + per-turn 执行日志) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让消息产物卡片只显示"本轮新增+改动"且与文件系统一致——靠一份执行期 per-turn 写入日志做归属,靠资源管理器(文件系统)做存在性,彻底替换旧的 message_parts 工具调用解析。

**Architecture:** 新增一个进程级 deliverable journal 模块,以 `conversation_id` 为键累积本轮写入(绝对路径 + create/modify)。三个写入口(write_file / edit_file / shell_execute 前后窄 diff)都向 journal 上报。流结束时把 journal 快照写进该 assistant 消息的 `extra_meta.file_outputs`。收集时(员工卡片 & 编排交付物)读 `file_outputs` 并与资源管理器扫描结果做**绝对路径集合交集**——删除/空文件自然落选。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / pytest(后端);React 19 / TypeScript / Zustand(前端)。

**关键设计约定:**
- journal 存**绝对解析 posix 路径**(`backend._resolve_path` / `resolved_path` 的结果),与 `resource_service` 的 `ResourceEntry.path`(同为绝对 posix)同坐标系,交集即集合成员判断。
- 桶过滤(只 artifacts / skills_draft)在交集阶段天然完成:只把这两个桶的文件路径纳入"文件系统当前集合"。
- `conversation_id` 作 journal 键是安全的:同一会话执行被 DB 工具锁串行化、且同一时刻至多一条活跃流(见 `stream_registry`)。
- **不做向后兼容、不做迁移**:旧 `message_parts` 解析直接删除,无 fallback。历史消息无 `file_outputs` → 卡片不显示历史产物(资源管理器面板仍可见磁盘文件)。

---

## File Structure

**新建:**
- `apps/server/src/service/agent/deliverable_journal.py` —— journal 核心:per-conversation 累积器、record、shell 目录 diff、snapshot_and_clear。单一职责,易单测。
- `apps/server/tests/test_deliverable_journal.py` —— journal 单测。
- `apps/server/tests/test_collect_plan_deliverables_journal.py` —— 收集层新路径单测。

**修改(后端):**
- `apps/server/src/service/agent/basic_file_backend.py` —— `basic_file_write` / `basic_file_edit` 写盘后向 journal 上报。
- `apps/server/src/service/skill_shell_backend.py` —— subprocess 前后扫 `artifacts_dir` 做 diff 上报。
- `apps/server/src/service/stream_registry.py` —— 流开始 `begin`、流结束把 journal 写入 `extra_meta.file_outputs`。
- `apps/server/src/service/orchestration_lifecycle.py` —— `collect_plan_deliverables` 改读 `file_outputs` + 文件系统交集;删 `_looks_like_product` / `get_conversation_tool_parts` 解析路径。

**修改(前端):**
- `apps/web/src/lib/chat/file-change-utils.ts` —— 新增 `getFileChangesFromFileOutputs(...)`;`getFileChangesFromUIMessage` 改为优先读 message metadata 的 `file_outputs`。
- `apps/web/src/components/chat/message-blocks/file-change-cards.tsx` —— 输入与 `apiResourceList` 求交集(过滤已删/空)。
- (Phase 3 第一步先调研)message `extra_meta` → 前端 UIMessage metadata 的透传链路。

---

## Phase 1 — Journal 核心模块

### Task 1: deliverable_journal 模块骨架 + 路径上报

**Files:**
- Create: `apps/server/src/service/agent/deliverable_journal.py`
- Test: `apps/server/tests/test_deliverable_journal.py`

- [ ] **Step 1: 写失败测试 —— record 累积与去重**

```python
# apps/server/tests/test_deliverable_journal.py
from src.service.agent import deliverable_journal as dj


def test_record_dedup_and_action_merge():
    conv = 9001
    dj.begin(conv)
    dj.record(conv, "/proj/artifacts/a.md", "create")
    dj.record(conv, "/proj/artifacts/a.md", "modify")  # 同文件再改 → 仍算 create
    dj.record(conv, "/proj/artifacts/b.csv", "modify")
    out = dj.snapshot_and_clear(conv)
    by_path = {o["path"]: o["action"] for o in out}
    assert by_path == {
        "/proj/artifacts/a.md": "create",
        "/proj/artifacts/b.csv": "modify",
    }
    # 取走后清空
    assert dj.snapshot_and_clear(conv) == []


def test_begin_resets_stale():
    conv = 9002
    dj.record(conv, "/proj/artifacts/old.md", "create")  # 无 begin 的残留
    dj.begin(conv)  # 重置
    dj.record(conv, "/proj/artifacts/new.md", "create")
    out = dj.snapshot_and_clear(conv)
    assert [o["path"] for o in out] == ["/proj/artifacts/new.md"]


def test_none_conversation_is_noop():
    dj.begin(None)
    dj.record(None, "/x/y.md", "create")  # 不崩
    assert dj.snapshot_and_clear(None) == []
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py -v`
Expected: FAIL(`ModuleNotFoundError` / `AttributeError`)

- [ ] **Step 3: 实现 journal 核心**

```python
# apps/server/src/service/agent/deliverable_journal.py
"""Per-turn 产物写入日志:以 conversation_id 为键累积本轮写入的文件(绝对 posix
路径 + create/modify),供流结束时写入消息 extra_meta.file_outputs。

为何进程级 dict 而非 contextvar:工具执行可能跨线程(deepagents to_thread / DB 写
线程),contextvar 不随线程传播;而 conversation_id 在各 backend 实例/上下文里都拿
得到,且同会话执行被串行化,用它作键既稳又简单。
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# conversation_id -> {abs_posix_path: action}。action: "create" | "modify"。
_journals: dict[int, dict[str, str]] = {}
_lock = threading.Lock()


def _norm(path: str) -> str:
    return Path(str(path)).resolve().as_posix()


def begin(conversation_id: int | None) -> None:
    """开一轮:清掉该会话的旧累积(防上一轮残留)。"""
    if conversation_id is None:
        return
    with _lock:
        _journals[conversation_id] = {}


def record(conversation_id: int | None, path: str, action: str) -> None:
    """上报一次写入。create 优先级高于 modify(同文件出现过 create 即 create)。"""
    if conversation_id is None or not path:
        return
    try:
        key = _norm(path)
    except OSError:
        return
    with _lock:
        bucket = _journals.setdefault(conversation_id, {})
        if bucket.get(key) == "create":
            return
        bucket[key] = action


def snapshot_and_clear(conversation_id: int | None) -> list[dict]:
    """取走并清空该会话累积,返回 [{path, action}]。"""
    if conversation_id is None:
        return []
    with _lock:
        bucket = _journals.pop(conversation_id, None)
    if not bucket:
        return []
    return [{"path": p, "action": a} for p, a in bucket.items()]
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/deliverable_journal.py apps/server/tests/test_deliverable_journal.py
git commit -m "feat(deliverable): journal 核心模块——per-conversation 写入累积"
```

---

### Task 2: shell 目录 diff helper

**Files:**
- Modify: `apps/server/src/service/agent/deliverable_journal.py`
- Test: `apps/server/tests/test_deliverable_journal.py`

- [ ] **Step 1: 写失败测试 —— 前后 diff 抓新增与改动**

```python
# 追加到 test_deliverable_journal.py
def test_shell_delta_detects_new_and_modified(tmp_path):
    conv = 9100
    root = tmp_path / "artifacts"
    root.mkdir()
    existing = root / "keep.txt"
    existing.write_text("v1", encoding="utf-8")

    dj.begin(conv)
    before = dj.scan_tree(root)

    # 模拟 shell 写:新文件 + 改已有
    (root / "made_by_bash.csv").write_text("x,y\n1,2", encoding="utf-8")
    existing.write_text("v2-longer", encoding="utf-8")  # size 变化

    after = dj.scan_tree(root)
    dj.record_shell_delta(conv, before, after)

    out = {o["path"]: o["action"] for o in dj.snapshot_and_clear(conv)}
    assert out[(root / "made_by_bash.csv").resolve().as_posix()] == "create"
    assert out[existing.resolve().as_posix()] == "modify"


def test_shell_delta_skips_internal_scratch(tmp_path):
    conv = 9101
    root = tmp_path / "artifacts"
    root.mkdir()
    dj.begin(conv)
    before = dj.scan_tree(root)
    (root / "_agent_exec_123.py").write_text("print(1)", encoding="utf-8")
    after = dj.scan_tree(root)
    dj.record_shell_delta(conv, before, after)
    assert dj.snapshot_and_clear(conv) == []
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py::test_shell_delta_detects_new_and_modified -v`
Expected: FAIL(`AttributeError: scan_tree`)

- [ ] **Step 3: 实现 scan_tree / record_shell_delta**

```python
# 追加到 deliverable_journal.py
from src.service.resource_service import _is_internal_scratch, _EXTERNAL_NOISE_DIRS


def scan_tree(root: Path) -> dict[str, tuple[float, int]]:
    """递归扫一个目录,返回 {abs_posix: (mtime, size)}。跳过内部 scratch / 噪音目录 /
    隐藏目录,与 resource_service 的展示口径一致,顺带把扫描成本压在产物文件上。"""
    out: dict[str, tuple[float, int]] = {}
    if not root.is_dir():
        return out
    for p in root.rglob("*"):
        name = p.name
        if any(
            part in _EXTERNAL_NOISE_DIRS or part.startswith(".")
            for part in p.relative_to(root).parts[:-1]
        ):
            continue
        if not p.is_file() or _is_internal_scratch(name):
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        out[p.resolve().as_posix()] = (st.st_mtime, st.st_size)
    return out


def record_shell_delta(
    conversation_id: int | None,
    before: dict[str, tuple[float, int]],
    after: dict[str, tuple[float, int]],
) -> None:
    """对比 shell 执行前后快照,新增→create、mtime/size 变化→modify,上报 journal。"""
    if conversation_id is None:
        return
    for path, sig in after.items():
        prev = before.get(path)
        if prev is None:
            record(conversation_id, path, "create")
        elif prev != sig:
            record(conversation_id, path, "modify")
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py -v`
Expected: PASS(全部)

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/deliverable_journal.py apps/server/tests/test_deliverable_journal.py
git commit -m "feat(deliverable): journal 增加 shell 目录前后 diff helper"
```

---

## Phase 2 — 三个写入口接 journal

### Task 3: write_file / edit_file 上报(挂在中间件,conv_id 可靠)

> **为何不挂 basic_file_backend:** 评审确认 async 工具走 `await resolved_backend.awrite(...)`,
> deepagents 基类 `awrite` 把 `self.write` offload 到 worker 线程,contextvar **不跨 to_thread 传播**
> → 从 `basic_file_write` 里读 `get_conversation_id()` 在默认(async)路径会拿到 None,journal 静默失效。
> 中间件 `compatible_filesystem_middleware.py` 在 sync/async 两条路径都已有可靠的
> `conv_id = conv_id_from_runtime(runtime)`(它给 write_guard 用),把上报挂这里。

**Files:**
- Modify: `apps/server/src/service/agent/deliverable_journal.py`(加 `report_file_write` 映射)
- Modify: `apps/server/src/service/agent/compatible_filesystem_middleware.py`
  - `sync_write_file`(~710)、`async_write_file`(~763):写成功后上报 create/modify
  - `sync_edit_file`(~841)、`async_edit_file`(~905):编辑成功后上报 modify
- Test: `apps/server/tests/test_deliverable_journal.py`

- [ ] **Step 1: 写失败测试 —— report_file_write 的 action 映射**

```python
# 追加到 test_deliverable_journal.py
def test_report_file_write_action_mapping():
    conv = 9200
    dj.begin(conv)
    dj.report_file_write(conv, "/proj/artifacts/new.md", existed_before=False, is_edit=False)   # → create
    dj.report_file_write(conv, "/proj/artifacts/old.md", existed_before=True, is_edit=False)    # → modify
    dj.report_file_write(conv, "/proj/artifacts/ed.md", existed_before=True, is_edit=True)      # → modify
    out = {o["path"]: o["action"] for o in dj.snapshot_and_clear(conv)}
    norm = lambda s: __import__("pathlib").Path(s).resolve().as_posix()
    assert out[norm("/proj/artifacts/new.md")] == "create"
    assert out[norm("/proj/artifacts/old.md")] == "modify"
    assert out[norm("/proj/artifacts/ed.md")] == "modify"
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py::test_report_file_write_action_mapping -v`
Expected: FAIL(`AttributeError: report_file_write`)

- [ ] **Step 3a: 在 deliverable_journal 加 report_file_write**

```python
# 追加到 deliverable_journal.py
def report_file_write(
    conversation_id: int | None, path: str, *, existed_before: bool, is_edit: bool
) -> None:
    """write/edit 成功后的统一上报。edit 必为 modify;write 视写前是否已存在分 create/modify。"""
    action = "modify" if (is_edit or existed_before) else "create"
    record(conversation_id, path, action)
```

- [ ] **Step 3b: 在中间件 4 处接入**

每处的模式:在调用 backend 写之前算 `existed_before`(用 backend 的 `_resolve_path` 拿与
journal/资源树一致的绝对路径),写成功(`res.error` 为空)后上报。示例(`async_write_file`,
其余三处同构,edit 传 `is_edit=True`):

```python
            # run_write_guard 通过、调用 awrite 之前:算 existed_before(整段裹一个 try,
            # 任何异常——含漏 import os 的 NameError——都吞掉,绝不影响写入主流程)
            from src.service.agent import deliverable_journal as dj
            import os
            _existed = False
            try:
                _resolved = str(resolved_backend._resolve_path(validated_path))
                _existed = os.path.exists(_resolved)
            except Exception:
                _resolved = validated_path

            res: WriteResult = await resolved_backend.awrite(validated_path, content)
            if res.error:
                return ToolMessage(... status="error")
            try:
                dj.report_file_write(conv_id, _resolved, existed_before=_existed, is_edit=False)
            except Exception:
                logger.debug("deliverable journal record failed", exc_info=True)
            return ToolMessage(... status="success")
```

> `conv_id` 在每个函数里已由 `conv_id = conv_id_from_runtime(runtime)` 取到(write_guard 用的同一个)。
> 上面用了函数内 `import os` 兜底(中间件文件顶部当前**未** import os);确认有 `logger`。
> sync 路径(`sync_write_file`/`sync_edit_file`)同样处理,edit 两处传 `is_edit=True`。

- [ ] **Step 4: 运行,确认通过**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/deliverable_journal.py apps/server/src/service/agent/compatible_filesystem_middleware.py apps/server/tests/test_deliverable_journal.py
git commit -m "feat(deliverable): write_file/edit_file 经中间件(可靠conv_id)上报 journal"
```

---

### Task 4: shell_execute 前后 diff 上报

**Files:**
- Modify: `apps/server/src/service/skill_shell_backend.py`(同步 `execute` ~876-903、异步 `aexecute` 的 `_read_lines_sync` ~592-600)
- Test: `apps/server/tests/test_deliverable_journal.py`

- [ ] **Step 1: 写失败测试 —— 经 shell backend 同步执行写文件被 journal 抓到**

```python
# 追加到 test_deliverable_journal.py(用真实 backend 的同步 execute)
def test_shell_execute_sync_reports_bash_written_file(tmp_path):
    import sys
    from src.service.skill_shell_backend import SkillAwareShellBackend

    conv = 9300
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    backend = SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=tmp_path / "skills",
        conversation_id=conv,
    )
    dj.begin(conv)
    # 跨平台:用 python 写一个文件(避开 echo 重定向差异)
    backend.execute(
        f'{sys.executable} -c "open(\'out.txt\',\'w\').write(\'hi\')"'
    )
    out = {o["path"]: o["action"] for o in dj.snapshot_and_clear(conv)}
    assert (artifacts / "out.txt").resolve().as_posix() in out
```

> 注:`SkillAwareShellBackend` 构造可能需要更多必填参数,实施时按真实签名补齐(参考 `orchestrator/agent.py` 的构造处)。若同步 `execute` 在测试环境受 guard 限制,改测 `aexecute`(用 `pytest.mark.asyncio`)。

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py::test_shell_execute_sync_reports_bash_written_file -v`
Expected: FAIL(无记录)

- [ ] **Step 3: 在 subprocess 执行处包 diff**

在 `execute` 与 `aexecute` 的 subprocess 调用**前**取 `before`,**后**取 `after` 并上报。例(同步 `execute`):

```python
from src.service.agent import deliverable_journal as dj
...
        _conv = self._conversation_id_int
        _before = dj.scan_tree(self._artifacts_dir) if _conv is not None else None
        try:
            result = subprocess.run(rewritten, ..., cwd=str(self.cwd))
        finally:
            if _before is not None:
                try:
                    dj.record_shell_delta(_conv, _before, dj.scan_tree(self._artifacts_dir))
                except Exception:
                    logger.debug("shell delta journal failed", exc_info=True)
```

异步 `aexecute` 的 `_read_lines_sync` 内 `subprocess.Popen` 同理,在 proc 结束(读完 stdout、`proc.wait()` 之后)做 after 扫描并上报。**后台 detached 路径不接**(进程在流结束后仍可能运行,捕获不到)——加一行 `logger.debug` 注明跳过即可。

- [ ] **Step 4: 运行,确认通过**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/skill_shell_backend.py apps/server/tests/test_deliverable_journal.py
git commit -m "feat(deliverable): shell_execute 前后 diff 上报 journal(抓 bash 写的文件)"
```

---

### Task 5: 流生命周期 —— begin + 落库 file_outputs

**Files:**
- Modify: `apps/server/src/service/stream_registry.py`(流开始 ~1706 处 `begin`;`_flush_to_db_sync` / `_flush_terminal_sync` ~314-335 写 extra_meta)
- Test: `apps/server/tests/test_deliverable_journal.py`(纯函数化的 extra_meta 合并)

- [ ] **Step 1: 写失败测试 —— extra_meta 合并 helper 不破坏已有 key**

为可测,把"把 file_outputs 合并进 extra_meta JSON 字符串"抽成纯函数 `merge_file_outputs_into_meta(extra_meta: str | None, outputs: list[dict]) -> str | None`,放在 `deliverable_journal.py`:

```python
def test_merge_file_outputs_preserves_existing_meta():
    import json
    from src.service.agent.deliverable_journal import merge_file_outputs_into_meta

    meta = json.dumps({"usage": {"t": 1}})
    merged = merge_file_outputs_into_meta(meta, [{"path": "/a", "action": "create"}])
    obj = json.loads(merged)
    assert obj["usage"] == {"t": 1}
    assert obj["file_outputs"] == [{"path": "/a", "action": "create"}]


def test_merge_empty_outputs_is_noop():
    from src.service.agent.deliverable_journal import merge_file_outputs_into_meta
    assert merge_file_outputs_into_meta(None, []) is None
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py -k merge -v`
Expected: FAIL

- [ ] **Step 3: 实现 merge helper + 接入 stream_registry**

`deliverable_journal.py` 增(`json` 已在 Task 5-merge 前的 import,确认有 `import json`):

```python
def merge_file_outputs_into_meta(extra_meta: str | None, outputs: list[dict]) -> str | None:
    if not outputs:
        return extra_meta
    try:
        meta = json.loads(extra_meta) if extra_meta else {}
    except (json.JSONDecodeError, TypeError):
        meta = {}
    meta["file_outputs"] = outputs
    return json.dumps(meta, ensure_ascii=False)
```

`stream_registry.py` 三处(锚点已核实):

1. **流开始 begin**:`_run_agent_background` 起始(拿到 `stream_msg_id` 与 `conversation_id` 后)
   调用 `deliverable_journal.begin(conversation_id)`。

2. **`_flush_to_db_sync`(286-344)新增参数 + 合并块**:给签名加 `file_outputs: list[dict] | None = None`;
   在 `elapsed_ms` 合并块(329-335)之后、`db.commit()`(336)之前,照同样 read-modify-write 模式加:

```python
                if file_outputs:
                    try:
                        meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                    meta["file_outputs"] = file_outputs
                    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
```

3. **`_flush_terminal_sync`(642-708)快照 + 透传**:它已持有入参 `conversation_id`。在调用
   `_flush_to_db_sync`(699)**之前**取快照,并把结果作为新参数传下去:

```python
    from src.service.agent import deliverable_journal as dj
    _file_outputs = dj.snapshot_and_clear(conversation_id)

    ok = _flush_to_db_sync(
        stream_msg_id,
        buffer_cursor,
        state=state,
        content=content,
        error_message=error_message,
        message_parts=message_parts_json,
        usage_metadata=usage_meta,
        elapsed_ms=elapsed_ms,
        file_outputs=_file_outputs,   # ← 新增
    )
```

> 关键:`_flush_to_db_sync` 是**唯一**加载 `msg` 并 `db.commit()` 的地方(`_flush_terminal_sync`
> 本身没有 `msg`/`commit`,直接在那写 `msg.extra_meta` 会 NameError)。snapshot 在
> `_flush_terminal_sync` 取(有 `conversation_id` 入参,非 contextvar,跨线程安全),merge 落在
> `_flush_to_db_sync`。`merge_file_outputs_into_meta` helper 供前面单测复用,生产路径直接走上面合并块即可。

- [ ] **Step 4: 运行,确认通过 + 全量后端回归**

Run: `cd apps/server && uv run pytest tests/test_deliverable_journal.py -v && uv run pytest -q`
Expected: journal 测试 PASS;全量无新增 failed。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/stream_registry.py apps/server/src/service/agent/deliverable_journal.py apps/server/tests/test_deliverable_journal.py
git commit -m "feat(deliverable): 流开始 begin、终态把 journal 落进 extra_meta.file_outputs"
```

---

## Phase 3 — 收集层与前端改读 file_outputs

### Task 6: collect_plan_deliverables 改读 file_outputs + 文件系统交集

**Files:**
- Modify: `apps/server/src/service/orchestration_lifecycle.py:18-123`(删 `_looks_like_product`、改 `collect_plan_deliverables`)
- Test: `apps/server/tests/test_collect_plan_deliverables_journal.py`

- [ ] **Step 1: 写失败测试**

构造:一个 plan + 一个 task + 一条 TaskExecutionLog(指向某 conversation),该 conversation 有一条 assistant 消息其 `extra_meta.file_outputs` 列了两个绝对路径;在 product_root/artifacts 下只真实放其中一个(另一个不放=已删)。断言 `collect_plan_deliverables` 只返回真实存在那个,且 `action` 来自 file_outputs。

```python
# apps/server/tests/test_collect_plan_deliverables_journal.py
# 复用现有测试夹具风格(参考 tests/test_deliverable_isolation.py 的建表/建会话方式)。
# 核心断言:
#   results = collect_plan_deliverables(db, plan.id, run_id=run.id)
#   paths = {r["basename"] for r in results}
#   assert paths == {"present.md"}            # 磁盘上不存在的 deleted.md 被过滤
#   assert results[0]["action"] == "create"
```

> 实施时先读 `tests/test_deliverable_isolation.py` 拿到建 plan/task/log/conversation/message 的现成 helper,照搬其夹具。

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_collect_plan_deliverables_journal.py -v`
Expected: FAIL

- [ ] **Step 3: 重写 collect_plan_deliverables**

要点:
1. 删 `_looks_like_product`、删对 `TaskService.get_conversation_tool_parts` 的依赖。
2. 新增 helper:读某 conversation 全部 assistant 消息的 `extra_meta.file_outputs`,返回 `[{path, action}]`(后出现的消息覆盖早的;同 path create 优先)。
3. 新增 helper:把 `ResourceService.list_resources(product_root)` 的 `artifacts`+`skills_draft` 两桶递归拍平成 `set[str]`(每个 file entry 的 `.path`,绝对 posix)。
4. 主流程:遍历 task → 最新 log(run_id 过滤逻辑不变)→ conversation → file_outputs,聚合去重(归属到 task);最后与文件系统集合**交集**保留,产出 `{path, basename, task_id, task_name, action, size}`(`size` 取文件系统 entry 的 size)。

```python
def _conversation_file_outputs(db: Session, conversation_id: int | None) -> list[dict]:
    if conversation_id is None:
        return []
    import json
    from src.models.conversation import ConversationMessage

    rows = db.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation_id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.asc())
    ).all()
    merged: dict[str, str] = {}
    for m in rows:
        try:
            meta = json.loads(m.extra_meta) if m.extra_meta else {}
        except (json.JSONDecodeError, TypeError):
            continue
        for fo in meta.get("file_outputs") or []:
            p, a = fo.get("path"), fo.get("action")
            if not p:
                continue
            if merged.get(p) == "create":
                continue
            merged[p] = a or "modify"
    return [{"path": p, "action": a} for p, a in merged.items()]


def _filesystem_deliverable_index(product_root) -> dict[str, "ResourceEntry"]:
    """artifacts + skills_draft 两桶所有 file entry,按 **resolve 后**绝对 posix path 索引。

    ⚠️ 路径坐标系对齐:journal 侧用 Path(...).resolve() 归一(可能解符号链接),而
    ResourceEntry.path 来自 iterdir 未 resolve。若 product_root 含符号链接,两边字符串不等
    → 交集会静默全空。故此处对 entry.path 也 resolve 后再做键,确保两侧同坐标。
    """
    from pathlib import Path
    from src.service.resource_service import ResourceService

    res = ResourceService.list_resources(product_root)
    index: dict = {}

    def walk(entries):
        for e in entries:
            if e.entry_type == "file":
                try:
                    key = Path(e.path).resolve().as_posix()
                except OSError:
                    key = e.path
                index[key] = e
            elif e.children:
                walk(e.children)

    walk(res.artifacts)
    walk(res.skills_draft)
    return index
```

`collect_plan_deliverables` 主体改为:聚合 `_conversation_file_outputs`(其 path 已是 journal 写下的
resolve 绝对 posix)→ 与 `_filesystem_deliverable_index(product_root)` 的键(同为 resolve 绝对 posix)
做交集。`product_root` 由 `resolve_conversation_product_root(db, plan_conversation)` 取(替换
`_plan_artifacts_dir`/`_still_exists_nonempty`)。

> **集成断言(加进 Task 6 测试)**:新写一个文件后,其 journal 路径字符串应与
> `_filesystem_deliverable_index` 的键命中——即"写一个文件→file_outputs 里那条能在文件系统索引里查到"。
> 这条断言守住路径坐标系不漂移。

- [ ] **Step 4: 运行,确认通过 + 隔离回归**

Run: `cd apps/server && uv run pytest tests/test_collect_plan_deliverables_journal.py tests/test_deliverable_isolation.py -v`
Expected: PASS(新测试 + run_id 隔离不回归)

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/orchestration_lifecycle.py apps/server/tests/test_collect_plan_deliverables_journal.py
git commit -m "refactor(deliverable): collect_plan_deliverables 改读 file_outputs+文件系统交集,删旧解析"
```

---

### Task 7: 前端调研 —— extra_meta → UIMessage metadata 透传

**Files:**
- 只读调研,产出结论写进本任务备注;可能 Modify:消息加载/序列化处(后端 message schema + 前端 message 映射)。

- [ ] **Step 1: 调研** message 的 `extra_meta` 当前有没有透传到前端 UIMessage。
  - 后端:搜 `extra_meta` 在 message 序列化(`apps/server/src/api/chat_api.py` / message schema)里有没有被吐给前端;`usage`/`elapsed_ms` 前端能读到吗?顺着同一条链路加 `file_outputs`。
  - 前端:搜 `getFileChangesFromUIMessage` 的调用方、`UIMessage` 的 metadata 形态、`message.metadata` 有没有承载后端 extra_meta。
- [ ] **Step 2: 结论** 决定 `file_outputs` 走 message metadata 的哪个字段到达前端(优先复用 usage/elapsed_ms 已走通的同一通道)。若该通道缺失,这一步补后端 schema 暴露 `file_outputs`。
- [ ] **Step 3: 提交**(若有 schema 改动)

```bash
git commit -m "feat(deliverable): message 透传 file_outputs 到前端 metadata"
```

> 此任务无独立自动化测试;以"前端能在 message 对象上读到 file_outputs"为完成判据(Task 8 的手测覆盖)。

---

### Task 8: 前端 FileChangeCards 改读 file_outputs ∩ 资源列表

> **依赖 Task 7:** 必须先确认 `file_outputs` 已透传到前端 message 对象。若没有数据,本任务做完也只会
> 显示空——Task 7 的结论是本任务的前置。

> **路径匹配容差:** message 的 `file_outputs.path` 是后端 journal 写下的 **resolve 绝对路径**,
> `apiResourceList` 条目的 `path` 是 `ResourceEntry.path`(未 resolve 绝对)。dev 环境 product_root 一般
> 无符号链接、两者相等;交集比较前两边都做轻归一(`replace(\\,/)`、Windows 下盘符小写),按 `path`
> 命中即可。命中不上时优先用 `rel_path` 兜底(后端两侧都有 rel_path 时更稳)。Task 9 的 e2e 验证此匹配。

**Files:**
- Modify: `apps/web/src/lib/chat/file-change-utils.ts`(新增 `getFileChangesFromFileOutputs`;改 `getFileChangesFromUIMessage`)
- Modify: `apps/web/src/components/chat/message-blocks/file-change-cards.tsx`(与 `apiResourceList` 交集)

- [ ] **Step 1: 新增 `getFileChangesFromFileOutputs`**

输入 message metadata 的 `file_outputs`(`[{path, action}]`)→ `FileChangeItem[]`。复用现有 `normalizeToolFilePath`/`getBasename`/`getExtension`/`classifyFileCategory`/`getSkillDraftFolder`/`isUserVisibleFileChange`。`action` 从 file_outputs 取(`create`→`created`,`modify`→`edited`)。

- [ ] **Step 2: 改 `getFileChangesFromUIMessage`**

优先读 `message.metadata.file_outputs`:有则走 `getFileChangesFromFileOutputs`;无(历史消息/流式中)则维持现有 parts 解析(流式即时显示用)。**删除"以 parts 为唯一来源"的假设**,但保留 parts 路径作流式兜底。

- [ ] **Step 3: FileChangeCards 与 apiResourceList 交集**

`file-change-cards.tsx` 已能拿 `conversationId`;复用 `useConversationPendingResources`/已有 `apiResourceList` query 拿当前资源树,把 `files` 过滤为"路径存在于资源树(artifacts/skills_draft 文件)"——删除/空文件不显示。流式中 apiResourceList 还没有该文件时,沿用 pending 即时显示(现状不变)。

- [ ] **Step 4: typecheck + lint**

Run: `pnpm lint --filter=web`(注:`apps/web` 的 `pnpm typecheck` 是空操作,真实类型检查用 `pnpm --filter web exec tsc -b`,但基线已有报错,只确认无**新增**本次相关报错)
Expected: 无新增报错

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/chat/file-change-utils.ts apps/web/src/components/chat/message-blocks/file-change-cards.tsx
git commit -m "feat(deliverable): 前端 FileChangeCards 改读 file_outputs 并与资源树交集"
```

---

## Phase 4 — 集成验证

### Task 9: 端到端手测

- [ ] **Step 1:** 重启后端 + `pnpm --filter web dev:app`,起一个会话。
- [ ] **Step 2:** 让 agent 一轮内:① `write_file` 建一个 .md;② `shell_execute` 用 python/bash 写一个 .csv;③ `edit_file` 改 .md;④ 建一个临时文件再 `rm` 掉。
- [ ] **Step 3:** 断言消息卡片"本轮文件变更"= .md(改动) + .csv(bash 新建),**临时文件不出现**;且这些都在资源管理器面板里看得到。
- [ ] **Step 4:** 跑一个编排计划(或定时轮),确认"团队交付物"卡片同样只列本轮真实存在的产物,run_id 隔离正常。
- [ ] **Step 5:** 并发起两个会话各写不同文件,确认各自卡片不串台。

> 手测脚本无自动断言;逐条记录观察结果。发现偏差回到对应 Task 修。

---

## 收尾

- [ ] 全量后端测试:`cd apps/server && uv run pytest -q` 无新增 failed。
- [ ] 使用 superpowers:requesting-code-review 复审整条改动。
- [ ] 使用 superpowers:finishing-a-development-branch 决定合并/PR。
