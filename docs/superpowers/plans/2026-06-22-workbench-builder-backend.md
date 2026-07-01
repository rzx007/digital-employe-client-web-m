# 工作台助手 + 资源池 — 后端实现计划（Plan 1 / 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"做看板"成为可装可卸的技能：新增「工作台助手」种子员工 + `workbench-builder` 内置技能；`arrange_workbench` 工具从总管专属改成「装了该技能就有」；新增资源池 DB 表 + REST API（含 HTML 上传）。

**Architecture:** `arrange_workbench` 当前依赖 orchestrator-only 的 `get_conversation_id()` context var，要改成 employee-safe 的 `conversation_id_from_runtime(runtime)`（与 `shell_execute_tool` 同款 runtime 注入），这样总管和员工都能用。种子员工走现有 `_BUILTIN_SEED_EMPLOYEES` 机制（仅加一条）。新 DB 表靠 `Base.metadata.create_all()` 自动建表（本项目无 Alembic）。

**Tech Stack:** Python / FastAPI / SQLAlchemy(Mapped 风格) / LangChain `@tool` / deepagents / pytest。

---

## 关键前置事实（实现者必读）

- **本项目无 Alembic**：[init_db.py:13](../../../apps/server/src/db/init_db.py#L13) 用 `Base.metadata.create_all(bind=get_engine())`。新表只要 import 进 `src.models`（[init_db.py:9](../../../apps/server/src/db/init_db.py#L9) `from src import models`）就会自动建表。**不需要写 migration**。
- **conversation_id 的两种取法**：
  - 总管：`from src.service.agent.orchestrator.runtime import get_conversation_id`（读 context var）。
  - 员工：`conversation_id_from_runtime(runtime)`（[runtime.py:56](../../../apps/server/src/service/agent/orchestrator/runtime.py#L56)，读 LangChain runtime 的 `config.configurable.thread_id`）。`shell_execute_tool` 用的就是后者（[shell_execute_tool.py:315-317](../../../apps/server/src/service/agent/shell_execute_tool.py#L315)）。
  - **统一解法**：让 `arrange_workbench` 接受注入的 `runtime`，优先 `conversation_id_from_runtime(runtime)`，回退 `get_conversation_id()`。两类 agent 都能用。
- **内置技能上盘只需 `SKILL.md`**：`build-in-skills/<name>/SKILL.md`（[paths.py:14](../../../apps/server/src/service/agent/paths.py#L14) `BUILD_IN_SKILLS_DIR = SERVER_ROOT / "build-in-skills"`）。启动时 [`seed_builtin_skills()`](../../../apps/server/src/service/local_skill_service.py#L371) 自动同步并分配 `localId`（-100 递减），无需手写 `.skill-meta.json`。
- **种子员工**：[`_BUILTIN_SEED_EMPLOYEES`](../../../apps/server/src/service/employee_service.py#L36) 加一行，[`ensure_builtin_seed_employees`](../../../apps/server/src/service/employee_service.py#L1220) 启动时按名字幂等创建。
- **运行测试**：`cd apps/server && uv run pytest <path> -v`。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/server/build-in-skills/workbench-builder/SKILL.md` | 工作台制作技能内容 | 新增 |
| `apps/server/src/service/agent/tools/__init__.py` | 通用 agent 工具包（脱离 orchestrator 命名空间） | 新增 |
| `apps/server/src/service/agent/tools/workbench.py` | `arrange_workbench` 迁移目标，runtime 注入版 | 新增 |
| `apps/server/src/service/agent/orchestrator/tools/workbench.py` | 旧位置 | 删除（re-export 改指向新位置以防外部 import 断） |
| `apps/server/src/service/agent/employee.py` | 装了 workbench-builder → 挂 arrange_workbench | 改 |
| `apps/server/src/service/agent/orchestrator/agent.py` | 总管收掉 arrange_workbench + prompt 段 | 改 |
| `apps/server/src/service/agent/orchestrator/tools/__init__.py` | 删 arrange_workbench re-export | 改 |
| `apps/server/src/service/agent/prompts.py` | 删 build_workbench_arrange_section | 改 |
| `apps/server/src/service/employee_service.py` | 加工作台助手种子 | 改 |
| `apps/server/src/models/workbench_resource.py` | 资源池 DB model | 新增 |
| `apps/server/src/models/__init__.py` | 注册新 model | 改 |
| `apps/server/src/schemas/workbench_resource.py` | Pydantic schema | 新增 |
| `apps/server/src/service/workbench_resource_service.py` | 资源池 CRUD | 新增 |
| `apps/server/src/api/workbench_resource_api.py` | 资源池 REST API + 上传 | 新增 |
| `apps/server/src/server.py`（或 api/__init__.py） | 注册新 router | 改 |

---

## Task 1: 迁移 `arrange_workbench` 到 runtime-注入版（通用工具包）

让工具用 `conversation_id_from_runtime(runtime)`，使总管与员工都可用。**协议（marker / ops / span 归一化）不动**——只换 conversation_id 来源。

**Files:**
- Create: `apps/server/src/service/agent/tools/__init__.py`
- Create: `apps/server/src/service/agent/tools/workbench.py`
- Test: `apps/server/tests/test_arrange_workbench_runtime.py`

- [ ] **Step 1: 写失败测试 — 工具能用 runtime 里的 conversation_id**

新建 `apps/server/tests/test_arrange_workbench_runtime.py`：

```python
"""arrange_workbench 迁移后：conversation_id 从注入的 runtime 取（员工/总管通用）。"""
from __future__ import annotations

import json
import types

from src.service.agent.tools.workbench import (
    normalize_operations,
    build_html_resolver_from_entries,
    ARRANGE_RESULT_MARKER,
)


def test_normalize_pin_resolves_real_path():
    entries = [{"name": "sales.html", "path": "/abs/conv-1/sales.html"}]
    resolver = build_html_resolver_from_entries(entries)
    ops, errors = normalize_operations(
        [{"op": "pin", "resourcePath": "sales.html"}], resolver
    )
    assert errors == []
    assert ops == [{"op": "pin", "resourcePath": "/abs/conv-1/sales.html"}]


def test_normalize_rejects_unknown_op():
    resolver = build_html_resolver_from_entries([])
    ops, errors = normalize_operations([{"op": "explode"}], resolver)
    assert ops == []
    assert errors and "未知" in errors[0]


def test_marker_is_stable():
    assert ARRANGE_RESULT_MARKER == "WORKBENCH_ARRANGE_V1"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_arrange_workbench_runtime.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.service.agent.tools.workbench'`

- [ ] **Step 3: 建通用工具包 + 迁移工具**

新建 `apps/server/src/service/agent/tools/__init__.py`：

```python
"""通用 agent 工具（不绑定总管/员工）。"""
from __future__ import annotations

from src.service.agent.tools.workbench import arrange_workbench

__all__ = ["arrange_workbench"]
```

新建 `apps/server/src/service/agent/tools/workbench.py` —— 复制现有 [orchestrator/tools/workbench.py](../../../apps/server/src/service/agent/orchestrator/tools/workbench.py) 全文，但做两处改动：

1. 顶部 import 改为（不再依赖 orchestrator-only context var 作唯一来源）：

```python
from src.service.agent.orchestrator.runtime import (
    conversation_id_from_runtime,
    get_conversation_id,
)
```

2. `_build_current_conversation_resolver` 改成接受可选 runtime，并优先 runtime：

```python
def _build_current_conversation_resolver(runtime=None):
    """列出当前会话产物建 .html 解析器。conversation_id：优先注入的 runtime
    （员工/总管通用），回退 orchestrator context var（总管旧路径）。"""
    cid = conversation_id_from_runtime(runtime)
    if cid is None:
        cid = get_conversation_id()
    if cid is None:
        return lambda _ref: None
    from src.service.resource_service import ResourceService

    listing = ResourceService.list_resources(get_settings().artifacts_path, int(cid))
    entries = [*listing.artifacts, *listing.workspace, *listing.public]
    return build_html_resolver_from_entries(entries)
```

3. 工具签名接受注入 runtime（LangChain 的 `ToolRuntime` 注入约定，与 shell_execute 同款）。把 `@tool` 函数改为：

```python
from langchain_core.tools import tool
from langchain.tools import ToolRuntime  # 若现有 shell_execute_tool 用别的导入路径，照抄它的


@tool
def arrange_workbench(operations: str, runtime: ToolRuntime = None) -> str:
    """编排工作台看板（在工作台页面的对话里可用）。
    ...（保留原 docstring 全文，仅把"总管对话"措辞改为"工作台对话"）...
    """
    try:
        parsed = json.loads(operations)
    except json.JSONDecodeError as exc:
        return f"错误：operations 不是合法 JSON：{exc}"
    try:
        resolve_path = _build_current_conversation_resolver(runtime)
        normalized, errors = normalize_operations(parsed, resolve_path)
    except ValueError as exc:
        return f"错误：{exc}"
    if not normalized:
        detail = "；".join(errors) if errors else "没有可执行的指令"
        return f"错误：{detail}"
    payload = {"marker": ARRANGE_RESULT_MARKER, "operations": normalized}
    summary = f"已下发 {len(normalized)} 条工作台编排指令。"
    if errors:
        summary += f"（{len(errors)} 条被忽略：{'；'.join(errors)}）"
    return f"{summary}\n{json.dumps(payload, ensure_ascii=False)}"
```

> **注意**：`ToolRuntime` 的确切导入路径要照抄 [shell_execute_tool.py](../../../apps/server/src/service/agent/shell_execute_tool.py) 里 watch/poll 工具拿 runtime 的写法（它已在生产用注入 runtime）。先 `grep -n "runtime" apps/server/src/service/agent/shell_execute_tool.py` 看它怎么声明注入参数，照搬同款签名，别自创。

`normalize_operations` / `build_html_resolver_from_entries` / `_normalize_span` / `_normalize_pos` / `SPAN_PRESETS` / `_KNOWN_OPS` / `ARRANGE_RESULT_MARKER` 全部原样复制到新文件。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_arrange_workbench_runtime.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: 旧位置改成 re-export（防外部 import 断）**

把 [orchestrator/tools/workbench.py](../../../apps/server/src/service/agent/orchestrator/tools/workbench.py) 全文替换为：

```python
"""[已迁移] arrange_workbench 已搬到 src.service.agent.tools.workbench。
本文件保留 re-export 以兼容历史 import，勿在此新增逻辑。"""
from __future__ import annotations

from src.service.agent.tools.workbench import (  # noqa: F401
    ARRANGE_RESULT_MARKER,
    arrange_workbench,
    build_html_resolver_from_entries,
    normalize_operations,
)

__all__ = [
    "arrange_workbench",
    "normalize_operations",
    "build_html_resolver_from_entries",
    "ARRANGE_RESULT_MARKER",
]
```

- [ ] **Step 6: 跑现有工作台工具测试确认没破协议**

Run: `cd apps/server && uv run pytest tests/test_workbench_tool.py -v`
Expected: PASS（现有测试仍绿——证明 marker/归一化协议没变）

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/service/agent/tools/ apps/server/src/service/agent/orchestrator/tools/workbench.py apps/server/tests/test_arrange_workbench_runtime.py
git commit -m "refactor(workbench): arrange_workbench 迁到通用工具包+runtime 注入取 conversation_id(员工/总管通用),旧位置 re-export"
```

---

## Task 2: 员工装了 `workbench-builder` 技能 → 挂 `arrange_workbench`

**Files:**
- Modify: `apps/server/src/service/agent/employee.py`（工具组装段，约 233-247 行）
- Test: `apps/server/tests/test_workbench_tool_mounted_by_skill.py`

- [ ] **Step 1: 写失败测试 — 装技能则有工具、不装则无**

新建 `apps/server/tests/test_workbench_tool_mounted_by_skill.py`：

```python
"""arrange_workbench 按 workbench-builder 技能挂载（不再硬编码给总管）。"""
from __future__ import annotations


def _tool_names(agent) -> set[str]:
    # deepagents agent 暴露已绑定工具的方式：优先 .tools，回退遍历。
    tools = getattr(agent, "tools", None) or []
    return {getattr(t, "name", "") for t in tools}


def test_employee_with_skill_has_arrange_workbench(tmp_path, monkeypatch):
    from src.service.agent import employee as emp_mod
    from src.service.agent.tools.workbench import arrange_workbench

    # 直接测纯函数：给定 available_skills 是否决定挂载
    assert emp_mod._should_mount_workbench(["workbench-builder", "docx"]) is True
    assert emp_mod._should_mount_workbench(["docx", "pdf"]) is False
    assert emp_mod._should_mount_workbench([]) is False
    # 工具对象存在且名字正确
    assert getattr(arrange_workbench, "name", "") == "arrange_workbench"
```

> 说明：直接构造完整 employee agent 较重（要 DB/模型/技能目录）。这里测一个**纯判定函数** `_should_mount_workbench(available_skills)`，把"该不该挂"的决策抽成可单测的纯函数，挂载点调用它。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_workbench_tool_mounted_by_skill.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_should_mount_workbench'`

- [ ] **Step 3: 加纯判定函数 + 条件挂载**

在 [employee.py](../../../apps/server/src/service/agent/employee.py) 顶部（其他模块级 helper 附近，如 `_augment_skills_with_skill_creator` 上方）加：

```python
WORKBENCH_BUILDER_SKILL = "workbench-builder"


def _should_mount_workbench(available_skills: list[str]) -> bool:
    """员工装了 workbench-builder 技能 → 应挂 arrange_workbench 工具。"""
    return WORKBENCH_BUILDER_SKILL in set(available_skills)
```

在 `get_agent` 里组装 `extra_tools` 之后（[employee.py:247](../../../apps/server/src/service/agent/employee.py#L247) 那个 `if enable_hitl or clarify_only_hitl:` 块**之后**、`create_deep_agent` 之前）加：

```python
    if _should_mount_workbench(available_skills):
        from src.service.agent.tools.workbench import arrange_workbench

        extra_tools.append(arrange_workbench)
```

> `available_skills` 在 [employee.py:84](../../../apps/server/src/service/agent/employee.py#L84) 已算出，且在 [178](../../../apps/server/src/service/agent/employee.py#L178) 被 `_augment_skills_with_skill_creator` 更新——用更新后的那个变量（178 行之后的 `available_skills`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_workbench_tool_mounted_by_skill.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/employee.py apps/server/tests/test_workbench_tool_mounted_by_skill.py
git commit -m "feat(workbench): 员工装 workbench-builder 技能即挂 arrange_workbench 工具"
```

---

## Task 3: 总管收掉 `arrange_workbench` + 删工作台 prompt 段

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/agent.py:40, 260, 335`
- Modify: `apps/server/src/service/agent/orchestrator/tools/__init__.py:71, 100-101`
- Modify: `apps/server/src/service/agent/prompts.py:121`（删 `build_workbench_arrange_section`）
- Modify: `apps/server/src/service/agent/orchestrator/agent.py:32`（删 import）
- Test: `apps/server/tests/test_orchestrator_no_arrange_workbench.py`

- [ ] **Step 1: 写失败测试 — 总管 agent 装配源码不含 arrange_workbench**

新建 `apps/server/tests/test_orchestrator_no_arrange_workbench.py`：

```python
"""总管不再持有 arrange_workbench 工具，也不再注入工作台编排 prompt 段。"""
from __future__ import annotations

from pathlib import Path


def _read(rel: str) -> str:
    root = Path(__file__).resolve().parents[1]  # apps/server/
    return (root / rel).read_text(encoding="utf-8")


def test_orchestrator_agent_no_arrange_workbench():
    src = _read("src/service/agent/orchestrator/agent.py")
    # 总管工具清单不再列入 arrange_workbench（裸名出现在工具 list 里）
    assert "arrange_workbench," not in src
    # 不再注入工作台编排 prompt 段
    assert "build_workbench_arrange_section" not in src


def test_prompts_module_drops_workbench_section():
    src = _read("src/service/agent/prompts.py")
    assert "def build_workbench_arrange_section" not in src
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_no_arrange_workbench.py -v`
Expected: FAIL（两条都失败——当前都还在）

- [ ] **Step 3: 在 orchestrator/agent.py 删除三处**

1. 删 [agent.py:40](../../../apps/server/src/service/agent/orchestrator/agent.py#L40) 工具 import 里的 `arrange_workbench,` 行（在 `from src.service.agent.orchestrator.tools import (` 块内）。
2. 删 [agent.py:32](../../../apps/server/src/service/agent/orchestrator/agent.py#L32) `build_workbench_arrange_section,`（在 `from src.service.agent.prompts import (` 块内）。
3. 删 [agent.py:260](../../../apps/server/src/service/agent/orchestrator/agent.py#L260) 的 `+ build_workbench_arrange_section()` 行。
4. 删 [agent.py:334-335](../../../apps/server/src/service/agent/orchestrator/agent.py#L334) 工具 list 里那两行注释 + `arrange_workbench,`：
   ```python
   # arrange_workbench 纯内存编排指令解析，不读写 DB、不走网络，故不包串行锁。
   arrange_workbench,
   ```

- [ ] **Step 4: 在 orchestrator/tools/__init__.py 删 re-export**

1. 删 [__init__.py:71](../../../apps/server/src/service/agent/orchestrator/tools/__init__.py#L71) `from src.service.agent.orchestrator.tools.workbench import arrange_workbench`。
   > ⚠️ Task 1 已把此文件改成 re-export 通用工具。这里要决定：总管 tools 包是否还导出 arrange_workbench？因总管不再用它，**删除 [__init__.py:71 + 100-101](../../../apps/server/src/service/agent/orchestrator/tools/__init__.py#L71) 的 `# workbench` / `"arrange_workbench",`** 两处（import 行 + `__all__` 里那条）。
2. 删 `__all__` 里 [__init__.py:100-101](../../../apps/server/src/service/agent/orchestrator/tools/__init__.py#L100)：
   ```python
   # workbench
   "arrange_workbench",
   ```

- [ ] **Step 5: 在 prompts.py 删 `build_workbench_arrange_section`**

删除 [prompts.py:121-132](../../../apps/server/src/service/agent/prompts.py#L121) 整个 `def build_workbench_arrange_section()` 函数。

- [ ] **Step 6: 跑测试 + 总管 agent 能 import（无残留引用）**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_no_arrange_workbench.py -v`
Expected: PASS

Run: `cd apps/server && uv run python -c "import src.service.agent.orchestrator.agent"`
Expected: 无 ImportError（证明删干净、没漏引用）

- [ ] **Step 7: 跑总管现有测试，确认没连带破坏**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_agent_paths.py tests/test_prompt_invariants.py -v`
Expected: PASS（若 `test_prompt_invariants` 里硬断言过 workbench 段存在，需同步更新该断言——读它确认）

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/ apps/server/src/service/agent/prompts.py apps/server/tests/test_orchestrator_no_arrange_workbench.py
git commit -m "refactor(orchestrator): 总管收掉 arrange_workbench 工具与工作台编排 prompt 段(做看板交给装技能的员工)"
```

---

## Task 4: `workbench-builder` 内置技能 SKILL.md

**Files:**
- Create: `apps/server/build-in-skills/workbench-builder/SKILL.md`
- Test: `apps/server/tests/test_workbench_builder_skill_present.py`

- [ ] **Step 1: 写失败测试 — 技能目录存在且 SKILL.md 提到 arrange_workbench**

新建 `apps/server/tests/test_workbench_builder_skill_present.py`：

```python
"""workbench-builder 内置技能存在且内容指向 arrange_workbench。"""
from __future__ import annotations

from pathlib import Path

from src.service.agent.paths import BUILD_IN_SKILLS_DIR


def test_workbench_builder_skill_md_exists_and_mentions_tool():
    skill_md = BUILD_IN_SKILLS_DIR / "workbench-builder" / "SKILL.md"
    assert skill_md.is_file(), f"missing {skill_md}"
    text = skill_md.read_text(encoding="utf-8")
    assert "arrange_workbench" in text
    assert "write_file" in text
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_workbench_builder_skill_present.py -v`
Expected: FAIL — `missing .../workbench-builder/SKILL.md`

- [ ] **Step 3: 写 SKILL.md**

新建 `apps/server/build-in-skills/workbench-builder/SKILL.md`：

```markdown
# Workbench Builder（工作台看板制作）

在工作台里做、改、组织 HTML 看板。用户在工作台对话里说「做个看板 / 改看板 / 调整布局」时走本流程。

## 何时用

- 用户要一个数据看板 / 仪表盘 / 报表页面（HTML）。
- 用户要调整工作台上已有看板（放大、移位、改标题、删除、并排）。

## 工作流

1. **生成 HTML 产物**：用 `write_file` 把看板写到当前产物目录（直接用相对文件名，如 `sales-dashboard.html`，cwd 已是产物目录）。
   - 单文件自包含：内联 CSS / JS；图表用 CDN 的 ECharts 或纯 SVG；响应式（容器宽度自适应）。
   - 不要在聊天正文粘贴完整 HTML——只说"已生成 <文件名>"。
2. **钉上工作台并排版**：调 `arrange_workbench`，一次可下发多条指令。
   - `pin` 的 `resourcePath` **只填刚写的文件名**（如 `"sales-dashboard.html"`），工具自动定位真实路径；不要拼 `/artifacts/` 前缀或绝对路径。
   - `blockRef` 用看板当前标题或 1 基序号。
   - 指令：`pin / resize / move / rename / hide / remove / reorder`。
   - span 档位：`small`(3×2) / `medium`(6×3) / `large`(6×6) / `full`(12×6)。

## arrange_workbench 指令示例

\`\`\`json
[
  {"op":"pin","resourcePath":"sales-dashboard.html","title":"销售看板","span":"large","pos":{"x":0,"y":0}},
  {"op":"resize","blockRef":"销售看板","span":"full"}
]
\`\`\`

## 禁止

- **禁止**把产物自作主张"加入资源池"——资源池入口只由用户在界面上点击触发，你没有入池工具。
- **禁止**用 `arrange_workbench` 之外的方式操控看板。
- **禁止**在聊天正文写出 `/artifacts/...` 等路径——交付时只说看板名称。
```

> markdown 里那段 ` ```json ` 代码块在真实文件里就是三反引号包裹（上面为在本计划内展示用了转义，落盘时写成正常三反引号）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_workbench_builder_skill_present.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/build-in-skills/workbench-builder/ apps/server/tests/test_workbench_builder_skill_present.py
git commit -m "feat(workbench): 新增 workbench-builder 内置技能(写 HTML+arrange_workbench 钉看板)"
```

---

## Task 5: 「工作台助手」种子员工

**Files:**
- Modify: `apps/server/src/service/employee_service.py:36`（`_BUILTIN_SEED_EMPLOYEES`）
- Test: `apps/server/tests/test_builtin_seed_employees.py`（追加断言）

- [ ] **Step 1: 在现有种子测试里加断言**

编辑 [apps/server/tests/test_builtin_seed_employees.py](../../../apps/server/tests/test_builtin_seed_employees.py)，在 `test_builtin_seed_contains_office_and_browser_assistants` 函数体末尾追加：

```python
    assert ("工作台助手", frozenset({"workbench-builder"})) in names
```

并在 `test_ensure_builtin_seed_creates_office_and_browser_assistants` 的断言区末尾追加：

```python
    assert by_name["工作台助手"] == {"workbench-builder"}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_builtin_seed_employees.py -v`
Expected: FAIL — `assert ("工作台助手", ...) in names`（KeyError / 断言失败）

- [ ] **Step 3: 加种子员工**

在 [employee_service.py:36 `_BUILTIN_SEED_EMPLOYEES`](../../../apps/server/src/service/employee_service.py#L36) 元组里、`问题反馈助手` 那条之后加：

```python
    (
        "工作台助手",
        ("workbench-builder",),
        "在工作台里做、改、组织 HTML 看板。",
    ),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_builtin_seed_employees.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/employee_service.py apps/server/tests/test_builtin_seed_employees.py
git commit -m "feat(workbench): 新增工作台助手种子员工(绑 workbench-builder 技能)"
```

---

## Task 6: 资源池 DB model

**Files:**
- Create: `apps/server/src/models/workbench_resource.py`
- Modify: `apps/server/src/models/__init__.py`
- Test: `apps/server/tests/test_workbench_resource_model.py`

- [ ] **Step 1: 写失败测试 — 表能建、能插能查**

新建 `apps/server/tests/test_workbench_resource_model.py`：

```python
"""workbench_resources 表：建表 + 基本读写。"""
from __future__ import annotations

from src.models.workbench_resource import WorkbenchResource


def test_model_table_name_and_columns():
    assert WorkbenchResource.__tablename__ == "workbench_resources"
    cols = set(WorkbenchResource.__table__.columns.keys())
    assert {
        "id", "workspace_id", "source", "src_path", "title", "added_by", "created_at"
    } <= cols


def test_insert_and_query(db_session, workspace):
    row = WorkbenchResource(
        workspace_id=workspace.id,
        source="upload",
        src_path="workbench-uploads/abc/x.html",
        title="测试看板",
        added_by="u1",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.id is not None
    assert row.created_at is not None
```

> `db_session` 和 `workspace` fixture 已在 [conftest.py] 提供（[test_builtin_seed_employees.py](../../../apps/server/tests/test_builtin_seed_employees.py) 已在用）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_workbench_resource_model.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.models.workbench_resource'`

- [ ] **Step 3: 写 model**

新建 `apps/server/src/models/workbench_resource.py`（镜像 [orchestration_plan.py](../../../apps/server/src/models/orchestration_plan.py) 的 Mapped 风格）：

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class WorkbenchResource(Base):
    __tablename__ = "workbench_resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "employee_artifact"（引用员工产物，不复制）| "upload"（外部上传，复制到 workbench-uploads/）
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="upload")
    # 相对 workspace.root_path 的 HTML 路径
    src_path: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    added_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now
    )
```

在 [apps/server/src/models/__init__.py](../../../apps/server/src/models/__init__.py) 加一行 import（与其它 model 同款，确保 `create_all` 注册）：

```python
from src.models.workbench_resource import WorkbenchResource  # noqa: F401
```

> 先 `grep -n "import" apps/server/src/models/__init__.py` 看现有 import 风格（裸 import vs `__all__`），照搬。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_workbench_resource_model.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/models/workbench_resource.py apps/server/src/models/__init__.py apps/server/tests/test_workbench_resource_model.py
git commit -m "feat(workbench): 资源池 DB model workbench_resources"
```

---

## Task 7: 资源池 schema + service（CRUD）

**Files:**
- Create: `apps/server/src/schemas/workbench_resource.py`
- Create: `apps/server/src/service/workbench_resource_service.py`
- Test: `apps/server/tests/test_workbench_resource_service.py`

- [ ] **Step 1: 写失败测试 — service 的 add/list/delete**

新建 `apps/server/tests/test_workbench_resource_service.py`：

```python
"""资源池 service：add（引用产物）/ list / delete。"""
from __future__ import annotations

import pytest

from src.service.workbench_resource_service import WorkbenchResourceService


def test_add_and_list(db_session, workspace):
    created = WorkbenchResourceService.add_artifact(
        db_session,
        workspace_id=workspace.id,
        src_path="employee-1/artifacts/sales.html",
        title="销售看板",
        added_by="u1",
    )
    assert created.id is not None
    assert created.source == "employee_artifact"

    items = WorkbenchResourceService.list_resources(db_session, workspace.id)
    assert len(items) == 1
    assert items[0].title == "销售看板"


def test_delete_artifact_only_removes_record(db_session, workspace):
    created = WorkbenchResourceService.add_artifact(
        db_session,
        workspace_id=workspace.id,
        src_path="employee-1/artifacts/x.html",
        title="x",
        added_by="u1",
    )
    WorkbenchResourceService.delete_resource(db_session, workspace.id, created.id)
    assert WorkbenchResourceService.list_resources(db_session, workspace.id) == []


def test_delete_missing_raises(db_session, workspace):
    with pytest.raises(Exception):
        WorkbenchResourceService.delete_resource(db_session, workspace.id, 99999)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_workbench_resource_service.py -v`
Expected: FAIL — `ModuleNotFoundError: src.service.workbench_resource_service`

- [ ] **Step 3: 写 schema**

新建 `apps/server/src/schemas/workbench_resource.py`（镜像 [schemas/workspace.py](../../../apps/server/src/schemas/workspace.py) 的 BaseModel 风格——先读它确认 `from_attributes`/`orm_mode` 配置）：

```python
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WorkbenchResourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    source: str
    src_path: str
    title: str
    added_by: str | None
    created_at: datetime


class WorkbenchResourceAddArtifact(BaseModel):
    workspace_id: int
    src_path: str
    title: str | None = None
```

- [ ] **Step 4: 写 service**

新建 `apps/server/src/service/workbench_resource_service.py`：

```python
from __future__ import annotations

from pathlib import PurePath

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.workbench_resource import WorkbenchResource


class WorkbenchResourceService:
    @staticmethod
    def list_resources(db: Session, workspace_id: int) -> list[WorkbenchResource]:
        return list(
            db.scalars(
                select(WorkbenchResource)
                .where(WorkbenchResource.workspace_id == workspace_id)
                .order_by(WorkbenchResource.created_at.desc())
            ).all()
        )

    @staticmethod
    def add_artifact(
        db: Session,
        *,
        workspace_id: int,
        src_path: str,
        title: str | None,
        added_by: str | None,
    ) -> WorkbenchResource:
        row = WorkbenchResource(
            workspace_id=workspace_id,
            source="employee_artifact",
            src_path=src_path,
            title=(title or PurePath(src_path).name),
            added_by=added_by,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    @staticmethod
    def add_upload(
        db: Session,
        *,
        workspace_id: int,
        src_path: str,
        title: str | None,
        added_by: str | None,
    ) -> WorkbenchResource:
        row = WorkbenchResource(
            workspace_id=workspace_id,
            source="upload",
            src_path=src_path,
            title=(title or PurePath(src_path).name),
            added_by=added_by,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    @staticmethod
    def delete_resource(db: Session, workspace_id: int, resource_id: int) -> None:
        row = db.get(WorkbenchResource, resource_id)
        if row is None or row.workspace_id != workspace_id:
            raise HTTPException(status_code=404, detail="资源不存在")
        db.delete(row)
        db.commit()
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_workbench_resource_service.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/schemas/workbench_resource.py apps/server/src/service/workbench_resource_service.py apps/server/tests/test_workbench_resource_service.py
git commit -m "feat(workbench): 资源池 service+schema(add_artifact/add_upload/list/delete)"
```

---

## Task 8: 资源池 REST API（含 HTML 上传）+ 注册 router

**Files:**
- Create: `apps/server/src/api/workbench_resource_api.py`
- Modify: 注册 router 的地方（先 grep `include_router` 找）
- Test: `apps/server/tests/test_workbench_resource_api.py`

- [ ] **Step 1: 先定位 router 注册 + 上传样板**

Run: `cd apps/server && grep -rn "include_router" src/server.py src/api/__init__.py`
Run: `cd apps/server && grep -rln "UploadFile" src/api/`
读到的 avatar/上传端点是上传样板（接收 `UploadFile`、校验大小、写盘）。读它，照搬大小校验与写盘方式。读到的 `include_router` 行是注册样板。

- [ ] **Step 2: 写失败测试 — list/add/delete 端点（用 FastAPI TestClient）**

新建 `apps/server/tests/test_workbench_resource_api.py`：

```python
"""资源池 API：list / add / delete。"""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.server import app  # 若 app 实例在别处，按实际 import 路径改

client = TestClient(app)


def test_add_list_delete_flow(workspace):
    ws = workspace.id
    # add（引用产物）
    r = client.post(
        "/workbench-resources/add",
        json={"workspace_id": ws, "src_path": "employee-1/artifacts/s.html", "title": "S"},
    )
    assert r.status_code in (200, 201), r.text
    rid = r.json()["data"]["id"]

    # list
    r = client.get("/workbench-resources/list", params={"workspace_id": ws})
    assert r.status_code == 200
    assert any(item["id"] == rid for item in r.json()["data"])

    # delete
    r = client.delete(f"/workbench-resources/{rid}", params={"workspace_id": ws})
    assert r.status_code == 200
```

> 若本仓库的 TestClient/DB 依赖注入需要特定 fixture（如覆盖 `get_db`），照抄现有某个 `test_*_api.py` 的 client 搭建方式（先 `grep -rln "TestClient" apps/server/tests/` 找样板）。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_workbench_resource_api.py -v`
Expected: FAIL — 404（路由还没注册）

- [ ] **Step 4: 写 API**

新建 `apps/server/src/api/workbench_resource_api.py`（镜像 [workspace_api.py](../../../apps/server/src/api/workspace_api.py) 的 router/response-model/`get_db` 约定）：

```python
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import ResponseBase, ListResponse
from src.schemas.workbench_resource import (
    WorkbenchResourceAddArtifact,
    WorkbenchResourceRead,
)
from src.service.workbench_resource_service import WorkbenchResourceService
from src.service.workspace_service import WorkspaceService

router = APIRouter(tags=["工作台资源池"])
logger = logging.getLogger(__name__)

MAX_HTML_BYTES = 10 * 1024 * 1024  # 10MB


@router.get("/workbench-resources/list", response_model=ListResponse[WorkbenchResourceRead])
def list_workbench_resources(
    workspace_id: int = Query(...), db: Session = Depends(get_db)
) -> ListResponse[WorkbenchResourceRead]:
    rows = WorkbenchResourceService.list_resources(db, workspace_id)
    return ListResponse(data=[WorkbenchResourceRead.model_validate(r) for r in rows])


@router.post("/workbench-resources/add", response_model=ResponseBase[WorkbenchResourceRead])
def add_workbench_resource(
    payload: WorkbenchResourceAddArtifact, db: Session = Depends(get_db)
) -> ResponseBase[WorkbenchResourceRead]:
    row = WorkbenchResourceService.add_artifact(
        db,
        workspace_id=payload.workspace_id,
        src_path=payload.src_path,
        title=payload.title,
        added_by=None,
    )
    return ResponseBase(data=WorkbenchResourceRead.model_validate(row))


@router.post("/workbench-resources/upload", response_model=ResponseBase[WorkbenchResourceRead])
async def upload_workbench_resource(
    workspace_id: int = Form(...),
    title: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ResponseBase[WorkbenchResourceRead]:
    name = file.filename or "upload.html"
    if not name.lower().endswith((".html", ".htm")):
        raise HTTPException(status_code=400, detail="只接受 .html/.htm 文件")
    content = await file.read()
    if len(content) > MAX_HTML_BYTES:
        raise HTTPException(status_code=400, detail="文件超过 10MB 上限")

    ws = WorkspaceService.get_workspace(db, workspace_id)
    rel_dir = Path("workbench-uploads") / uuid.uuid4().hex
    abs_dir = Path(ws.root_path) / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)
    (abs_dir / name).write_bytes(content)
    rel_path = str((rel_dir / name).as_posix())

    row = WorkbenchResourceService.add_upload(
        db, workspace_id=workspace_id, src_path=rel_path, title=title, added_by=None
    )
    return ResponseBase(data=WorkbenchResourceRead.model_validate(row))


@router.delete("/workbench-resources/{resource_id}", response_model=ResponseBase[dict])
def delete_workbench_resource(
    resource_id: int, workspace_id: int = Query(...), db: Session = Depends(get_db)
) -> ResponseBase[dict]:
    # upload 来源同时删物理文件；employee_artifact 仅删登记。
    row = db.get(__import__("src.models.workbench_resource", fromlist=["WorkbenchResource"]).WorkbenchResource, resource_id)
    if row is not None and row.workspace_id == workspace_id and row.source == "upload":
        try:
            ws = WorkspaceService.get_workspace(db, workspace_id)
            fp = Path(ws.root_path) / row.src_path
            if fp.is_file():
                fp.unlink()
        except Exception as exc:  # 物理删除失败不阻塞登记删除
            logger.warning("删除上传文件失败 %s: %s", row.src_path, exc)
    WorkbenchResourceService.delete_resource(db, workspace_id, resource_id)
    return ResponseBase(data={"deleted": resource_id})
```

> ⚠️ `MAX_HTML_BYTES`、`ResponseBase`/`ListResponse` 的确切 import 路径与泛型用法、`WorkspaceService.get_workspace` 签名都要对照 [workspace_api.py](../../../apps/server/src/api/workspace_api.py) / [src/models/response.py] 实际写法核对。`delete` 里那行动态 import 写得别扭——落地时改成文件顶部正常 `from src.models.workbench_resource import WorkbenchResource` 再 `db.get(WorkbenchResource, resource_id)`。

在 Step 1 找到的 `include_router` 处注册（与现有 router 同款）：

```python
from src.api.workbench_resource_api import router as workbench_resource_router
app.include_router(workbench_resource_router)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_workbench_resource_api.py -v`
Expected: PASS

- [ ] **Step 6: 跑后端全量回归**

Run: `cd apps/server && uv run pytest -q`
Expected: 全绿（或仅与本改动无关的既有失败）

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/api/workbench_resource_api.py apps/server/src/server.py apps/server/tests/test_workbench_resource_api.py
git commit -m "feat(workbench): 资源池 REST API(list/add/upload/delete)+注册 router"
```

---

## Self-Review（已对 spec 逐条核）

- ✅ 工作台助手种子员工 → Task 5
- ✅ workbench-builder 内置技能 → Task 4
- ✅ arrange_workbench 按技能挂载 → Task 1（迁移）+ Task 2（员工挂载）
- ✅ 总管收掉 arrange_workbench + prompt 段 → Task 3
- ✅ 资源池 DB 表 → Task 6
- ✅ 资源池 CRUD（list/add/upload/delete）→ Task 7 + Task 8
- ✅ upload 复制到 workbench-uploads/、employee_artifact 仅登记 → Task 7/8
- ✅ 仅用户入池（无 agent 入池工具）→ 全程没有给 agent 任何资源池写工具
- ⏭ 前端（切换器/资源面板/拖入网格/members/toast）→ **Plan 2**

**未决/执行期注意**：
- `ToolRuntime` 注入的确切签名要照抄 `shell_execute_tool` 的 watch 工具（Task 1 Step 3 已标注）。
- `ResponseBase`/`ListResponse` 泛型用法、`WorkspaceService.get_workspace` 签名照 `workspace_api.py` 核对（Task 8 已标注）。
- `models/__init__.py` 的 import 风格照现有（Task 6 已标注）。

---

## Execution Handoff

见会话——写完 Plan 2 后统一交付选择。
