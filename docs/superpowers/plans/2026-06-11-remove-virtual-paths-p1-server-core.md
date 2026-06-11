# 去虚拟路径 · P1 服务端 agent 核心 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让员工与总管 agent 全部改用真实磁盘绝对路径（删 CompositeBackend 虚拟路由 + 删 shim + 注入目录 env + 真实路径 skills/memory + prompt 重写），并删除 `/skills/` 写禁用让技能可被 agent 修改。

**Architecture:** `CompositeBackend(default=shell_backend, routes={...})` 当前已用 `shell_backend`（`SkillAwareShellBackend`，`LocalShellBackend` 子类）作为"未命中路由的本机绝对路径"兜底后端。P1 删掉所有 route，让 `SkillAwareShellBackend` 直接作为 agent 唯一 backend 统管真实路径；放行绝对路径的 `validate_path` 逻辑从独立 `validate_path_shim.py` 收进已有的 `install_compatible_filesystem_middleware()`（仓库唯一的 deepagents 集成 patch 点），删除 shim 文件。

**Tech Stack:** Python 3.12 · deepagents（vendored `OpenAICompatibleFilesystemMiddleware`）· pytest · FastAPI。

**本计划范围 = spec 的 P1（仅服务端 agent 核心）。** P0 契约里只有"注入 env 名"属 P1；资源 schema/API（P2）、前端（P3）、browserctl（P4）是后续独立计划。P1 完成后 agent 用真实路径、技能可改，但**工作台资源面板尚未适配**（P2/P3 之前会暂时显示原始路径/链接失效）——这是已知的相位中间态，最终原子合并。

**参考 spec：** [docs/superpowers/specs/2026-06-11-remove-virtual-paths-design.md](../specs/2026-06-11-remove-virtual-paths-design.md)

---

## 关键事实（实现前必读）

1. deepagents 文件工具（ls/read/write/edit）在 `deepagents/middleware/filesystem.py` 里调**模块内** `_validate_path(...)`（定义于该文件 ~line 95），它对 `^[A-Za-z]:` 开头的 Windows 绝对路径**抛 ValueError**（拒绝）。
2. cfm 覆盖的 `read_file` 用的是 `from deepagents.backends.utils import validate_path`（公有名）。
3. 现有 `validate_path_shim.install_validate_path_shim()` 同时 patch 三处：`backends.utils.validate_path`、`middleware.filesystem.validate_path`（**注意：工具实际调的是 `_validate_path`，此处可能是历史遗留无效 patch，spike 会验证**）、`cfm.validate_path`。
4. `is_host_absolute_path()` / `normalize_host_path()`（`path_access/host_paths.py`）是放行判定纯函数，**保留复用**。
5. `SkillAwareShellBackend` 当前已是 `CompositeBackend(default=...)` 的兜底后端，本机绝对路径的 read/edit 已由它的 `read()`/`edit()`（委托 `basic_file_read/edit`）处理；write/ls 继承自 `LocalShellBackend`。

---

## Task 0：Spike — 实测删 shim 后绝对路径校验行为

**目的**：在写替代逻辑前，用可运行测试钉死「哪个符号被工具实际调用」「卸载 shim 后绝对路径是否真被拒」「`LocalShellBackend` 是否实现 write/ls_info/download_files」，避免基于源码猜测写错替代点。

**Files:**
- Create: `apps/server/tests/test_validate_path_shim_spike.py`（spike 用，Task 5 后可删或转正式断言）

- [ ] **Step 1：写 spike 测试，记录三件事**

```python
# apps/server/tests/test_validate_path_shim_spike.py
"""Spike：钉死 deepagents 绝对路径校验与 backend 能力，指导删 shim 的替代实现。

执行：uv run pytest tests/test_validate_path_shim_spike.py -v -s
读 -s 的打印结论，不强制断言（探针）。
"""
import pytest


def test_probe_validate_path_symbols():
    from deepagents.middleware import filesystem as fsm
    from deepagents.backends import utils as bu

    # (a) 工具实际调用的符号：模块内 _validate_path
    assert hasattr(fsm, "_validate_path"), "工具调用的是 _validate_path"
    print("\n[probe] fsm._validate_path =", fsm._validate_path)
    print("[probe] fsm has 'validate_path' attr? =", hasattr(fsm, "validate_path"))
    print("[probe] bu.validate_path =", bu.validate_path)

    # (b) 未打补丁时，绝对路径是否被拒
    import re
    raised = False
    try:
        fsm._validate_path(r"D:\space\foo.txt")
    except ValueError as e:
        raised = True
        print("[probe] _validate_path(D:\\...) raised:", e)
    print("[probe] absolute path rejected by _validate_path =", raised)


def test_probe_localshell_backend_capabilities(tmp_path):
    from deepagents.backends import LocalShellBackend

    b = LocalShellBackend(root_dir=str(tmp_path), virtual_mode=False)
    for attr in ("read", "write", "edit", "ls_info", "als_info", "download_files"):
        print(f"[probe] LocalShellBackend.{attr} =", hasattr(b, attr))
```

- [ ] **Step 2：运行 spike，记录结论**

Run: `cd apps/server; uv run pytest tests/test_validate_path_shim_spike.py -v -s`
Expected: PASS（探针），输出含三组 `[probe]`。**把结论记进 commit message**：
- 工具调 `_validate_path`，绝对路径 `rejected = True`（预期）。
- `LocalShellBackend` 是否实现 `write/ls_info/download_files`（决定 Task 4/5 是否要补后端方法）。

- [ ] **Step 3：Commit spike + 结论**

```bash
git add apps/server/tests/test_validate_path_shim_spike.py
git commit -m "test(spike): 钉死 deepagents 绝对路径校验符号与 backend 能力"
```

> **若 spike 显示 `LocalShellBackend` 缺 `write`/`ls_info`/`download_files`**：在 Task 4 给 `SkillAwareShellBackend` 补这些方法（委托 `pathlib`/`basic_file_*`）。下文按"已实现"路径写；缺失时按本注补。

---

## Task 1：放行绝对路径逻辑收进 cfm，删 shim 文件

**Files:**
- Modify: `apps/server/src/service/agent/compatible_filesystem_middleware.py`（`install_compatible_filesystem_middleware()` ~line 622-632）
- Modify: `apps/server/src/service/agent/path_access/__init__.py`（删 `install()` 里 shim 调用，保留 install() 空壳或删调用点）
- Modify: `apps/server/src/server.py:25` 附近（`install_agent_path_access` 调用语义不变即可）
- Delete: `apps/server/src/service/agent/path_access/validate_path_shim.py`
- Delete: `apps/server/src/service/agent/path_access/PEEL_OFF.md`（shim 剥离说明，随 shim 删）
- Test: `apps/server/tests/test_validate_path_physical.py`（新建，取代旧 `test_validate_path_shim.py`）

- [ ] **Step 1：写失败测试 — 安装 cfm 后绝对路径被放行、虚拟/穿越仍被拒**

```python
# apps/server/tests/test_validate_path_physical.py
"""删 shim 后：放行本机绝对路径的逻辑由 install_compatible_filesystem_middleware 承担。"""
from deepagents.middleware import filesystem as fsm
from deepagents.backends import utils as bu

from src.service.agent.compatible_filesystem_middleware import (
    install_compatible_filesystem_middleware,
)


def setup_module(_):
    install_compatible_filesystem_middleware()  # 幂等


def test_windows_absolute_allowed():
    # 工具实际调用点
    assert fsm._validate_path(r"D:\space\foo.txt") == "D:/space/foo.txt"


def test_unix_absolute_allowed():
    assert fsm._validate_path("/home/u/x.md") == "/home/u/x.md"


def test_traversal_still_rejected():
    import pytest
    with pytest.raises(ValueError):
        fsm._validate_path("../etc/passwd")


def test_virtual_like_path_passthrough():
    # 不再有虚拟前缀概念；以 / 开头的普通绝对路径按 host 放行
    assert fsm._validate_path("/workspace/a.txt") == "/workspace/a.txt"
```

- [ ] **Step 2：运行，确认失败**

Run: `cd apps/server; uv run pytest tests/test_validate_path_physical.py -v`
Expected: FAIL（`test_windows_absolute_allowed` 抛 `ValueError: Windows absolute paths are not supported`，因尚未把放行逻辑接入 cfm）。

- [ ] **Step 3：在 cfm 安装函数里 patch `_validate_path`（含工具实际调用的下划线符号）**

在 `compatible_filesystem_middleware.py` 顶部已 `from deepagents.backends.utils import (... validate_path)`。新增放行包装并在安装函数里 patch。把下列加入文件（安装函数附近）：

```python
from collections.abc import Sequence as _Sequence

from src.service.agent.path_access.host_paths import (
    is_host_absolute_path,
    normalize_host_path,
)

_orig_backend_validate_path = bu_validate_path  # 见下：import 别名


def _validate_path_allow_physical(path, *, allowed_prefixes=None):
    """放行本机绝对路径（Windows 盘符 / Unix 绝对）；其余沿用 deepagents 原校验。"""
    if is_host_absolute_path(path):
        return normalize_host_path(path)
    return _orig_backend_validate_path(path, allowed_prefixes=allowed_prefixes)
```

把现有 `from deepagents.backends.utils import (... validate_path)` 改为带别名导入：`validate_path as bu_validate_path`（并同步改文件内对 `validate_path` 的引用为 `bu_validate_path`，cfm 内若有用到）。

修改 `install_compatible_filesystem_middleware()`（替换其函数体为）：

```python
def install_compatible_filesystem_middleware() -> None:
    """替换 deepagents 的 FilesystemMiddleware，并放行本机绝对路径。幂等。"""
    from deepagents.middleware import filesystem as fs_module
    from deepagents import graph as graph_module
    from deepagents.backends import utils as backend_utils

    fs_module.FilesystemMiddleware = OpenAICompatibleFilesystemMiddleware
    graph_module.FilesystemMiddleware = OpenAICompatibleFilesystemMiddleware

    # 放行本机绝对路径：工具实际调用的是模块内 _validate_path；
    # cfm.read_file 与各 backend 用的是 backends.utils.validate_path。三处统一放行。
    fs_module._validate_path = _validate_path_allow_physical
    backend_utils.validate_path = _validate_path_allow_physical
    globals()["bu_validate_path"] = _validate_path_allow_physical  # cfm 自身 read 路径

    logger.info(
        "Installed OpenAICompatibleFilesystemMiddleware + physical path passthrough"
    )
```

> 注：`_orig_backend_validate_path` 必须在 patch **之前**绑定原函数（模块导入时 `bu_validate_path` 即原 `validate_path`）。确认 `is_host_absolute_path` 对以 `/` 开头路径的判定——它依赖 `virtual_paths.is_virtual_path`，Task 6 删虚拟前缀后需让 `is_virtual_path` 恒为 False 或移除该分支（见 Task 6 Step 3）。

- [ ] **Step 4：删 shim 文件 + 解除 path_access 对它的调用**

删除文件：
```bash
git rm apps/server/src/service/agent/path_access/validate_path_shim.py apps/server/src/service/agent/path_access/PEEL_OFF.md
```

改 `path_access/__init__.py` 的 `install()`（放行逻辑已移走，install 不再做 shim）：

```python
def install() -> None:
    """物理路径放行已并入 install_compatible_filesystem_middleware()；此处保留为兼容空操作。"""
    logger.info("Agent physical path mode (validate_path passthrough handled by cfm)")
```

（`server.py` 仍调 `install_agent_path_access()` 与 `install_compatible_filesystem_middleware()`，顺序不限——前者现为 no-op，后者负责放行。保持现状即可。）

- [ ] **Step 5：运行测试，确认通过**

Run: `cd apps/server; uv run pytest tests/test_validate_path_physical.py -v`
Expected: PASS（4 项）。

- [ ] **Step 6：删旧 shim 测试**

```bash
git rm apps/server/tests/test_validate_path_shim.py
```

- [ ] **Step 7：Commit**

```bash
git add -A apps/server
git commit -m "refactor(path): 放行绝对路径并入 cfm 安装，删 validate_path_shim"
```

---

## Task 2：`SkillAwareShellBackend` 注入目录环境变量

**Files:**
- Modify: `apps/server/src/service/skill_shell_backend.py`（`__init__` ~line 155-161）
- Test: `apps/server/tests/test_shell_env_inject.py`（新建）

- [ ] **Step 1：写失败测试**

```python
# apps/server/tests/test_shell_env_inject.py
from pathlib import Path
from src.service.skill_shell_backend import SkillAwareShellBackend


def _backend(tmp_path: Path, with_uploads=True, with_draft=True):
    skills = tmp_path / "skills"; skills.mkdir()
    artifacts = tmp_path / "artifacts"; artifacts.mkdir()
    memories = tmp_path / "memories"; memories.mkdir()
    uploads = tmp_path / "uploads"; uploads.mkdir() if with_uploads else None
    draft = tmp_path / "draft"; draft.mkdir() if with_draft else None
    return SkillAwareShellBackend(
        root_dir=str(artifacts), skills_root=skills,
        draft_root=draft if with_draft else None,
        memories_root=memories,
        uploads_root=uploads if with_uploads else None,
        conversation_id=42, virtual_mode=False,
    )


def test_injects_directory_env(tmp_path):
    b = _backend(tmp_path)
    assert b._env["ARTIFACTS_DIR"] == str((tmp_path / "artifacts").resolve())
    assert b._env["SKILLS_DIR"] == str((tmp_path / "skills").resolve())
    assert b._env["MEMORIES_DIR"] == str((tmp_path / "memories").resolve())
    assert b._env["UPLOADS_DIR"] == str((tmp_path / "uploads").resolve())
    assert b._env["SKILLS_DRAFT_DIR"] == str((tmp_path / "draft").resolve())
    assert b._env["CONVERSATION_ID"] == "42"


def test_optional_dirs_absent(tmp_path):
    b = _backend(tmp_path, with_uploads=False, with_draft=False)
    assert "UPLOADS_DIR" not in b._env
    assert "SKILLS_DRAFT_DIR" not in b._env
```

- [ ] **Step 2：运行确认失败**

Run: `cd apps/server; uv run pytest tests/test_shell_env_inject.py -v`
Expected: FAIL（KeyError: 'ARTIFACTS_DIR'）。

- [ ] **Step 3：在 `__init__` 注入 env**

在 `skill_shell_backend.py` 的 `__init__`，`CONVERSATION_ID` 注入块之后加：

```python
        # 注入产物/技能/记忆等目录的真实绝对路径，供 agent 与子进程（browserctl 等）
        # 以真实路径定位，取代已删除的虚拟前缀。
        self._env["ARTIFACTS_DIR"] = str(self._artifacts_dir)
        self._env["SKILLS_DIR"] = str(self._skills_root)
        if self._memories_root is not None:
            self._env["MEMORIES_DIR"] = str(self._memories_root)
        if self._uploads_root is not None:
            self._env["UPLOADS_DIR"] = str(self._uploads_root)
        if self._draft_root is not None:
            self._env["SKILLS_DRAFT_DIR"] = str(self._draft_root)
```

（`self._artifacts_dir` 等已在前文 `.resolve()`，见现有 `__init__`。）

- [ ] **Step 4：运行确认通过**

Run: `cd apps/server; uv run pytest tests/test_shell_env_inject.py -v`
Expected: PASS（2 项）。

- [ ] **Step 5：Commit**

```bash
git add apps/server/src/service/skill_shell_backend.py apps/server/tests/test_shell_env_inject.py
git commit -m "feat(shell): 注入 ARTIFACTS_DIR 等目录 env，替代虚拟前缀定位"
```

---

## Task 3：删除 shell 命令虚拟前缀 rewrite

**Files:**
- Modify: `apps/server/src/service/skill_shell_backend.py`（`_prepare_shell_command`、`_rewrite_command_virtual_paths`、`_map_virtual_token`）
- Modify: `apps/server/tests/test_shell_virtual_rewrite.py` → 改为"真实路径直通"断言

- [ ] **Step 1：改测试为"命令原样直通，不再 rewrite"**

把 `test_shell_virtual_rewrite.py` 全文替换为：

```python
"""删除虚拟前缀 rewrite 后：shell 命令原样执行，仅保留多行 python -c 落盘（NT）。"""
from pathlib import Path
from src.service.skill_shell_backend import SkillAwareShellBackend


def _backend(tmp_path: Path) -> SkillAwareShellBackend:
    skills = tmp_path / "skills"; skills.mkdir()
    artifacts = tmp_path / "artifacts"; artifacts.mkdir()
    return SkillAwareShellBackend(
        root_dir=str(artifacts), skills_root=skills,
        draft_root=None, virtual_mode=False,
    )


def test_command_passthrough_no_rewrite(tmp_path):
    b = _backend(tmp_path)
    cmd = 'curl -s "http://x/y?a=1" -o out.json'
    assert b._prepare_shell_command(cmd) == cmd


def test_absolute_path_command_unchanged(tmp_path):
    b = _backend(tmp_path)
    art = b._env["ARTIFACTS_DIR"]
    cmd = f'python "{art}/script.py"'
    assert b._prepare_shell_command(cmd) == cmd
```

- [ ] **Step 2：运行确认失败**

Run: `cd apps/server; uv run pytest tests/test_shell_virtual_rewrite.py -v`
Expected: FAIL（`_prepare_shell_command` 仍调 rewrite，且 `_rewrite_command_virtual_paths` 可能改写；或 import 旧符号）。

- [ ] **Step 3：删 rewrite，`_prepare_shell_command` 只留多行落盘**

在 `skill_shell_backend.py`：
- 删除方法 `_rewrite_command_virtual_paths` 与 `_map_virtual_token`。
- 删除顶部 `from src.service.agent.path_access.virtual_paths import map_virtual_token`。
- `_prepare_shell_command` 改为：

```python
    def _prepare_shell_command(self, command: str) -> str:
        # 不再做虚拟前缀 rewrite：agent 直接用真实绝对路径。
        # 仅保留 Windows 多行 python -c 落盘（与路径虚拟化无关）。
        return self._materialize_multiline_python_c(command)
```

- [ ] **Step 4：运行确认通过**

Run: `cd apps/server; uv run pytest tests/test_shell_virtual_rewrite.py -v`
Expected: PASS（2 项）。

- [ ] **Step 5：Commit**

```bash
git add apps/server/src/service/skill_shell_backend.py apps/server/tests/test_shell_virtual_rewrite.py
git commit -m "refactor(shell): 删除虚拟前缀 rewrite，命令直用真实路径"
```

---

## Task 4：`employee.py` — 删路由、真实路径 skills/memory、删写禁用

**Files:**
- Modify: `apps/server/src/service/agent/employee.py`（`134-198` routes/backend、`230-247` create_deep_agent 的 memory/skills/system_prompt、`257-268` permissions）
- Test: `apps/server/tests/test_employee_agent_paths.py`（新建，断言 backend 构造与权限不含虚拟前缀）

- [ ] **Step 1：写失败测试（结构断言，不跑 LLM）**

```python
# apps/server/tests/test_employee_agent_paths.py
"""employee agent：backend 不再是 CompositeBackend 虚拟路由；技能可写。"""
import inspect
from src.service.agent import employee as emp


def test_no_composite_routes_in_source():
    src = inspect.getsource(emp.get_agent)
    # 不再注册虚拟路由
    assert '"/skills/"' not in src
    assert '"/artifacts/"' not in src
    assert 'CompositeBackend' not in src


def test_no_skills_write_deny_in_source():
    src = inspect.getsource(emp.get_agent)
    # 不再 deny /skills 写
    assert '"/skills/**"' not in src


def test_skills_memory_use_real_paths():
    src = inspect.getsource(emp.get_agent)
    # skills=/memory= 用变量构造真实路径，不再用虚拟前缀字面量
    assert 'memory=["/agent/AGENTS.md"' not in src
    assert 'skills=skill_sources' in src or 'skills=[' in src
```

- [ ] **Step 2：运行确认失败**

Run: `cd apps/server; uv run pytest tests/test_employee_agent_paths.py -v`
Expected: FAIL（源码仍含 `CompositeBackend`、`"/skills/**"` 等）。

- [ ] **Step 3：改 `employee.py`**

(a) 删除 `routes` 字典构造（`134-179` 整段 `routes: dict[...] = {...}` 与各 `routes[...] = ...`、`skills_fs`/`agent_fs`/`memories_fs`/`BasicFileFilesystemBackend(...)` route 实例），但**保留**目录变量计算（`memories_dir`、`artifacts_dir`、`draft_dir`、`uploads_dir`、`history_dir`）——这些目录仍需 `mkdir` 并传给 shell_backend / skills= / memory=。保留 `has_draft_route`/`use_session_history` 布尔（用于 skills 源与 prompt）。

(b) `backend` 改为直接用 shell_backend：

```python
    backend = shell_backend  # 删 CompositeBackend：真实路径全部由 shell-aware 后端兜底
```

（删除 `from deepagents.backends import CompositeBackend, FilesystemBackend` 与 `BasicFileFilesystemBackend` import 中已不用的项；`FilesystemBackend`/`BasicFileFilesystemBackend` 若别处不再用则一并删 import。）

(c) `create_deep_agent` 的 `memory=`/`skills=` 改真实路径：

```python
        memory=[
            str((base_dir / "AGENTS.md")),
            str((memories_dir / "AGENTS.md")),
        ],
        skills=skill_sources,  # 见下：skill_sources 改真实路径
```

并把 `skill_sources` 定义（原 `["/skills/", "/skills-draft/"] if has_draft_route else ["/skills/"]`）改为：

```python
    skill_sources = [str(skills_root)]
    if has_draft_route and draft_dir is not None:
        skill_sources.append(str(draft_dir))
```

(d) `permissions=` 删 `/skills/**` 写禁用（技能可改）；`/agent/**`、`/memories/AGENTS.md` 改真实路径或一并放开。按 spec Q1=全放开 / Q1 暂定保留 AGENTS.md 写禁用——这里**删 `/skills/**` 与 `/agent/**` 两条**，仅保留 `AGENTS.md` 写禁用改真实路径：

```python
        permissions=[
            FilesystemPermission(
                operations=["write"],
                paths=[str(memories_dir / "AGENTS.md"), str(base_dir / "AGENTS.md")],
                mode="deny",
            ),
        ],
```

> 说明：base_dir 下的 `/agent/AGENTS.md`（系统级指引）仍禁写以防误改；技能（`skills_root`、`draft_dir`）放开。若 Q1 后续改为"内置技能也禁写"，在此对 `skills_root` 下内置技能子目录加 deny。

(e) `build_system_prompt(...)` 调用的 `virtual_mode=` 实参：保持传 `is_agent_virtual_mode()`（Task 7 重写 prompt 内部）。

- [ ] **Step 4：运行确认通过**

Run: `cd apps/server; uv run pytest tests/test_employee_agent_paths.py -v`
Expected: PASS（3 项）。

- [ ] **Step 5：冒烟 — 构造 agent 不抛异常**

```bash
cd apps/server; uv run python -c "from src.service.agent.compatible_filesystem_middleware import install_compatible_filesystem_middleware as i; i(); from src.service.agent.employee import get_agent; a=get_agent(None, None, employee_id=None, conversation_id=None); print('ok', type(a).__name__)"
```
Expected: 打印 `ok ...`（agent 成功构造）。若报 backend 缺方法 → 按 Task 0 注记给 `SkillAwareShellBackend` 补 `write`/`ls_info`/`download_files`。

- [ ] **Step 6：Commit**

```bash
git add apps/server/src/service/agent/employee.py apps/server/tests/test_employee_agent_paths.py
git commit -m "refactor(employee): 删虚拟路由/写禁用，skills+memory 改真实路径"
```

---

## Task 5：`orchestrator/agent.py` — 同 employee 改造

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/agent.py`（`167-218` routes/backend、`286-289` memory/skills、`333-344` permissions）
- Test: `apps/server/tests/test_orchestrator_agent_paths.py`（新建）

- [ ] **Step 1：写失败测试**

```python
# apps/server/tests/test_orchestrator_agent_paths.py
import inspect
from src.service.agent.orchestrator import agent as orch


def test_orch_no_composite_routes():
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert 'CompositeBackend' not in src
    assert '"/skills/"' not in src
    assert '"/artifacts/"' not in src


def test_orch_skills_memory_real_paths():
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert 'memory=["/agent/AGENTS.md"' not in src
    assert 'skills=["/skills/"]' not in src
```

- [ ] **Step 2：运行确认失败**

Run: `cd apps/server; uv run pytest tests/test_orchestrator_agent_paths.py -v`
Expected: FAIL。

- [ ] **Step 3：改 `orchestrator/agent.py`**（与 employee 对称）

(a) 删 `routes` 字典（`187-203`）与 `skills_fs`/`agent_fs`/`memories_fs`/route 实例；保留 `skills_root`、`memories_dir`、`artifacts_dir`、`uploads_dir`、`conversation_dir` 计算与 mkdir。
(b) `backend = shell_backend`（删 `CompositeBackend(...)`，line 218）。
(c) `create_deep_agent`：
```python
        memory=[str(base_dir / "AGENTS.md"), str(memories_dir / "AGENTS.md")],
        skills=[str(skills_root)],
```
(d) `permissions=` 删 `/agent/**` 那条，`AGENTS.md` 写禁用改真实路径：
```python
        permissions=[
            FilesystemPermission(
                operations=["write"],
                paths=[str(memories_dir / "AGENTS.md"), str(base_dir / "AGENTS.md")],
                mode="deny",
            ),
        ],
```
(e) 删不再使用的 import（`CompositeBackend`、`FilesystemBackend`、`BasicFileFilesystemBackend`，若别处不用）。

- [ ] **Step 4：运行确认通过 + 冒烟**

Run: `cd apps/server; uv run pytest tests/test_orchestrator_agent_paths.py -v`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add apps/server/src/service/agent/orchestrator/agent.py apps/server/tests/test_orchestrator_agent_paths.py
git commit -m "refactor(orchestrator): 删虚拟路由/写禁用，skills+memory 改真实路径"
```

---

## Task 6：删虚拟前缀纯函数 + 收尾依赖

**Files:**
- Modify: `apps/server/src/service/agent/path_access/host_paths.py`（去掉对 `is_virtual_path` 的依赖）
- Delete: `apps/server/src/service/agent/path_access/virtual_paths.py`
- Modify: `apps/server/src/service/skill_invocation_inference.py`、`apps/server/src/service/agent_message_builder.py`（若引用虚拟前缀，改真实路径或删；按 grep 结果处理）
- Modify/Delete: `apps/server/tests/test_virtual_paths.py`、`test_host_paths.py`、`test_virtual_route_integration.py`、`test_prompt_invariants.py`（按引用调整）

- [ ] **Step 1：grep 残余引用**

Run:
```bash
cd apps/server; grep -rn "virtual_paths\|map_virtual_token\|is_virtual_path\|VIRTUAL_PREFIXES" src/ tests/
```
Expected: 列出全部引用点（应仅剩 host_paths.py、test_virtual_paths.py、可能 skill_invocation_inference.py）。

- [ ] **Step 2：改 `host_paths.py` 去掉虚拟前缀依赖**

```python
def is_host_absolute_path(path: str) -> bool:
    """是否为本机物理绝对路径（三端）。删虚拟前缀后，所有 / 开头绝对路径均按 host 处理。"""
    if not path:
        return False
    if _WINDOWS_DRIVE_RE.match(path):
        return True
    if path.startswith("/"):
        return True
    return False
```
删除 `from src.service.agent.path_access.virtual_paths import is_virtual_path`。

- [ ] **Step 3：删 `virtual_paths.py` 与其测试，修其余引用**

```bash
cd apps/server; git rm src/service/agent/path_access/virtual_paths.py tests/test_virtual_paths.py
```
对 Step 1 grep 出的其余引用（如 `skill_invocation_inference.py` 用 `/skills/` 正则识别技能调用）逐一改为真实路径判定或删除该逻辑。`test_host_paths.py` 删除"虚拟前缀边界"相关用例，保留三端绝对路径用例。`test_virtual_route_integration.py` 整体删除（route 已不存在）：`git rm tests/test_virtual_route_integration.py`。

- [ ] **Step 4：运行 path_access 相关测试全绿**

Run: `cd apps/server; uv run pytest tests/test_host_paths.py tests/test_validate_path_physical.py -v`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add -A apps/server
git commit -m "refactor(path): 删 virtual_paths 纯函数与虚拟前缀残余引用"
```

---

## Task 7：重写 prompt — 教 agent 用真实路径

**Files:**
- Modify: `apps/server/src/service/agent/prompts.py`（`build_filesystem_prompt_section` 7-90+）
- Modify: `apps/server/src/service/agent/path_access/prompt_rules.py`（`build_file_tool_rules`）
- Modify: `apps/server/src/service/agent/shell_execute_tool.py:39` 附近（虚拟路径提示）
- Modify: `apps/server/src/service/agent/AGENTS.md`（虚拟前缀示例改真实路径）
- Test: `apps/server/tests/test_filesystem_prompt_physical.py`（新建）

- [ ] **Step 1：写失败测试 — prompt 不含虚拟前缀、含真实路径与 env 提示**

```python
# apps/server/tests/test_filesystem_prompt_physical.py
from src.service.agent.prompts import build_filesystem_prompt_section


def test_prompt_uses_real_paths_not_virtual():
    s = build_filesystem_prompt_section(
        skills_real_path=r"D:\ws\skills",
        artifacts_real_path=r"D:\ws\conv\1\artifacts",
        memories_real_path=r"D:\ws\mem",
        agent_real_path=r"D:\ws\agent",
        uploads_real_path=r"D:\ws\conv\1\uploads",
        use_session_history=True,
        virtual_mode=False,
    )
    # 不再教虚拟前缀
    assert "/artifacts/" not in s
    assert "/skills/" not in s
    assert "/uploads/" not in s
    # 含真实路径
    assert r"D:\ws\conv\1\artifacts" in s or "D:/ws/conv/1/artifacts" in s
    # 提示可用 env（ARTIFACTS_DIR 等）
    assert "ARTIFACTS_DIR" in s
```

- [ ] **Step 2：运行确认失败**

Run: `cd apps/server; uv run pytest tests/test_filesystem_prompt_physical.py -v`
Expected: FAIL（当前文案含 `/artifacts/`）。

- [ ] **Step 3：重写 `build_filesystem_prompt_section` 与 `build_file_tool_rules`**

`prompt_rules.build_file_tool_rules`：删除 `virtual_mode=True` 分支整段；物理分支文案删掉所有"/artifacts/、/uploads/、/skills/ 虚拟前缀会自动映射"等句，改为：

```python
def build_file_tool_rules(*, virtual_mode: bool = False, artifacts_real_path: str = "") -> str:
    art = artifacts_real_path or "见上表 ARTIFACTS_DIR"
    return f"""
        ### 文件工具（read_file / write_file / edit_file / ls）
        - **一律使用真实磁盘绝对路径**（Windows `D:/...`、macOS `/Users/...`、Linux `/home/...`）
        - **交付给用户的成品**写入产物目录：`{art}`（也可用环境变量 `$ARTIFACTS_DIR`，shell 默认 cwd 即此目录）
        - **技能**在 `$SKILLS_DIR`，**可读可改**（直接 edit_file 技能里的 SKILL.md 等）
        - 用户上传在 `$UPLOADS_DIR`；记忆在 `$MEMORIES_DIR`
        - read_file 支持 PDF/Office 文本提取、图片多模态
        - write_file 仅用于新建；重写已存在文件只用 edit_file
        - 调 write_file/edit_file 时 JSON 先写 file_path 再写 content/new_string

        ### shell_execute
        - 使用 `shell_execute`；默认 cwd = 产物目录（`{art}`）
        - 路径用真实绝对路径或环境变量（`$ARTIFACTS_DIR`/`$SKILLS_DIR`/`$UPLOADS_DIR`）
        """
```

`prompts.build_filesystem_prompt_section`：把 `path_mappings`（`/skills/ → ...`）改为只列**真实路径表**（去掉左侧虚拟前缀列），并补一行 env 对照；删 `draft_instruction` 里"/skills/ 只读、用 /skills-draft/ 覆盖"的话术，改为"技能可直接修改"；`history_hint` 改真实 history 路径。确保输出含 `ARTIFACTS_DIR` 字样（满足测试），例如在表后追加：

```
    env_hint = (
        "可用环境变量定位目录：$ARTIFACTS_DIR(产物) $SKILLS_DIR(技能) "
        "$UPLOADS_DIR(上传) $MEMORIES_DIR(记忆)。"
    )
```
并把真实路径表（`artifacts_real_path` 等）拼进返回串。

`shell_execute_tool.py:39` 附近：删"不要用虚拟路径，改用物理路径"提示中关于虚拟前缀映射的句子，改为"路径用真实绝对路径或 $ARTIFACTS_DIR 等环境变量"。

`AGENTS.md`：把所有 `/artifacts/xxx`、`/skills/xxx` 示例替换为 `$ARTIFACTS_DIR/xxx`、`$SKILLS_DIR/xxx`（或真实路径示例）。

- [ ] **Step 4：运行确认通过**

Run: `cd apps/server; uv run pytest tests/test_filesystem_prompt_physical.py -v`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add apps/server/src/service/agent/prompts.py apps/server/src/service/agent/path_access/prompt_rules.py apps/server/src/service/agent/shell_execute_tool.py apps/server/src/service/agent/AGENTS.md apps/server/tests/test_filesystem_prompt_physical.py
git commit -m "docs(prompt): 文件工具/ shell 文案改真实路径+env，技能可改"
```

---

## Task 8：P1 全量回归 + 清理 spike

**Files:**
- Delete: `apps/server/tests/test_validate_path_shim_spike.py`（结论已固化进 Task 1 测试）
- Modify: `apps/server/docs/path-access-recap.md`（更新双轨→单轨真实路径）

- [ ] **Step 1：删 spike 测试**

```bash
cd apps/server; git rm tests/test_validate_path_shim_spike.py
```

- [ ] **Step 2：跑 path/agent 相关测试全绿**

Run:
```bash
cd apps/server; uv run pytest tests/test_validate_path_physical.py tests/test_shell_env_inject.py tests/test_shell_virtual_rewrite.py tests/test_employee_agent_paths.py tests/test_orchestrator_agent_paths.py tests/test_host_paths.py tests/test_filesystem_prompt_physical.py -v
```
Expected: 全 PASS。

- [ ] **Step 3：跑整套后端测试，确认无连带破坏**

Run: `cd apps/server; uv run pytest -q`
Expected: 仅"已知将由 P2/P3/P4 修复"的资源/前端契约相关测试可能失败（记录之）；agent/path 相关全绿。把失败清单记入 commit message 作为 P2 输入。

- [ ] **Step 4：更新 recap 文档**

把 `apps/server/docs/path-access-recap.md` 第 1 节"双轨路径"改为"单轨真实路径 + 交付物目录分桶（P2 起前端按真实子目录分桶）"，标注 shim/虚拟前缀已删、技能可改。

- [ ] **Step 5：Commit**

```bash
git add -A apps/server
git commit -m "test(path): P1 全量回归通过，更新 path-access recap；删 spike"
```

---

## Self-Review（已对照 spec P1）

- **spec P1.1 删路由**：Task 4/5 Step 3(a)(b)。✓
- **spec P1.2 skills/memory 真实路径**：Task 4/5 Step 3(c)。✓
- **spec P1.3 删写禁用→技能可改**：Task 4/5 Step 3(d)。✓
- **spec P1.4 注入 env**：Task 2。✓
- **spec P1.5 删 shell rewrite**：Task 3。✓
- **spec P1.6 prompt 重写**：Task 7。✓
- **spec P1.7 / Q2 AGENT_VIRTUAL_MODE**：本计划未删开关本身（保守，留 env 回退），但物理路径放行已不依赖它（并入 cfm）。`is_agent_virtual_mode()` 仍传入 prompt/backend `virtual_mode=` 作沙箱控制——**若 Q2 要彻底删开关，追加一个清理 task**（标记为 P1 可选收尾，避免与本计划主线耦合）。
- **spec Q4 删 shim**：Task 1。✓
- **依赖未决点**：`download_files`/`write`/`ls_info` 在 `SkillAwareShellBackend` 的可用性 → Task 0 spike 验证，缺则 Task 4 Step 5 注记补齐。

## 风险与回退

- 最大风险：删 shim 后某条文件工具路径仍走未 patch 的校验符号 → Task 0 spike + Task 1 测试覆盖三处符号；冒烟（Task 4 Step 5）兜底。
- 回退：本计划纯服务端、按 task 小步提交；任一 task 失败可 `git revert` 该 commit，不影响前序。
