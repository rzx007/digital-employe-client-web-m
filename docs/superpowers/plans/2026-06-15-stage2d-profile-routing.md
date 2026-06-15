# 阶段 2D：profile 回喂路由（收尾学习闭环）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：[阶段2 总览](2026-06-15-stage2-learning-loop-overview.md) §2D。基底 `feat/orchestrator-centric`（2A/2B/2C 完成）。

**Goal:** 总管组队时读各员工 `<brain>/profile.md`（2C 生成的能力画像），让它按"谁干过/擅长这类活"选人、复用老员工——**闭合学习闭环**（捕获→提炼→复盘画像→回喂选人）。

**Architecture:** 在 `orchestrator/prompts.py` 的 `build_employee_capability_context`(总管读的员工能力表)**表格之后追加「员工能力画像」段**：遍历员工，读各自 profile.md（有则贴）。总管经 `list_workspace_employees` 工具看到能力表 + 画像，据此组队。纯加性、profile 缺失则跳过、容错。

**Tech Stack:** Python / pytest。测试 `cd apps/server && uv run pytest tests/... -v`。

---

## 设计要点（实现前必读）

**现状**（prompts.py:111-179）：`build_employee_capability_context(db, workspace_id)` 返回一个 markdown 员工表（| ID | 姓名 | 岗位 | 总管 | 技能 | MCP | 定时任务 |）。`list_workspace_employees` 工具(employees.py:100)返回它，总管组队时读。

**2D 改造**：表格后追加一段：
```
## 员工能力画像（历史复盘）
### 林晓（ID 42）
<profile.md 内容>
### 陈睿（ID 43）
<profile.md 内容>
```
只列**有 profile.md** 的员工；都没有则不加该段（保持原样）。profile 路径 = `resolve_employee_memories_dir(employee_id).parent / "profile.md"`（与 2C/librarian 一致）。

**纯加性 + 容错**：读 profile 失败/不存在→跳过该员工；不破坏原表格；不改 `list_workspace_employees` 工具本身（它调 build_employee_capability_context，自动带上画像）。

**文件结构**：
- 改：`apps/server/src/service/agent/orchestrator/prompts.py`
- 测：新建 `apps/server/tests/test_profile_routing.py`

---

## Task 1：profile 读取 + 画像段构建 helper

**Files:** Modify `prompts.py`；Test `tests/test_profile_routing.py`

- [ ] **Step 1: 写失败测试**（新建）

```python
"""2D：profile 回喂路由。"""
from pathlib import Path


def test_read_employee_profile(monkeypatch, tmp_path):
    from src.service.agent.orchestrator import prompts
    # 把 profile 路径解析重定向到 tmp
    monkeypatch.setattr(prompts, "_profile_path_for", lambda eid: tmp_path / str(eid) / "profile.md")
    pf = tmp_path / "42" / "profile.md"
    pf.parent.mkdir(parents=True, exist_ok=True)
    pf.write_text("# 能力画像\n- 擅长芯片调研", encoding="utf-8")

    assert "芯片调研" in prompts._read_employee_profile(42)
    assert prompts._read_employee_profile(99) == ""  # 无文件→空串


def test_build_profiles_section(monkeypatch, tmp_path):
    from src.service.agent.orchestrator import prompts

    class _Emp:
        def __init__(self, id, name): self.id = id; self.name = name

    monkeypatch.setattr(prompts, "_read_employee_profile",
                        lambda eid: "- 擅长X" if eid == 1 else "")
    section = prompts.build_employee_profiles_section([_Emp(1, "甲"), _Emp(2, "乙")])
    assert "能力画像" in section
    assert "甲" in section and "擅长X" in section
    assert "乙" not in section  # 无 profile 的不列


def test_build_profiles_section_empty_when_none(monkeypatch):
    from src.service.agent.orchestrator import prompts
    monkeypatch.setattr(prompts, "_read_employee_profile", lambda eid: "")
    class _Emp:
        def __init__(self, id, name): self.id = id; self.name = name
    assert prompts.build_employee_profiles_section([_Emp(1, "甲")]) == ""
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_profile_routing.py -v`

- [ ] **Step 3: 实现**（加到 prompts.py；顶部确认 `from pathlib import Path` 或在 helper 内 import）

```python
def _profile_path_for(employee_id: int) -> Path:
    from src.service.agent.paths import resolve_employee_memories_dir
    return resolve_employee_memories_dir(employee_id=employee_id).parent / "profile.md"


def _read_employee_profile(employee_id: int) -> str:
    try:
        p = _profile_path_for(employee_id)
        if not p.is_file():
            return ""
        from src.service.basic_file_reader import read_text_with_encoding_fallback
        return read_text_with_encoding_fallback(p).strip()
    except Exception:
        return ""


def build_employee_profiles_section(employees) -> str:
    """有 profile.md 的员工→拼成「能力画像」段；都没有则返回 ''。"""
    blocks: list[str] = []
    for emp in employees:
        text = _read_employee_profile(emp.id)
        if not text:
            continue
        blocks.append(f"### {emp.name}（ID {emp.id}）\n{text}")
    if not blocks:
        return ""
    return "## 员工能力画像（历史复盘）\n\n" + "\n\n".join(blocks)
```
（`Path` 类型注解：确认 prompts.py 顶部有 `from pathlib import Path`，没有则加。）

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_profile_routing.py -v`

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/tests/test_profile_routing.py
git commit -m "feat(learning): profile 读取 + 能力画像段构建 helper"
```

---

## Task 2：注入 build_employee_capability_context

**Files:** Modify `prompts.py`（`build_employee_capability_context` 末尾）；Test `tests/test_profile_routing.py`

- [ ] **Step 1: 写失败测试**（追加；用真实 db + add_employee + monkeypatch profile）

```python
def test_capability_context_includes_profiles(monkeypatch, db_session, workspace):
    from src.service.agent.orchestrator import prompts
    from tests.conftest import add_employee
    emp = add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(prompts, "_read_employee_profile",
                        lambda eid: "- 擅长芯片调研" if eid == emp.id else "")
    ctx = prompts.build_employee_capability_context(db_session, workspace.id)
    assert "| ID | 姓名" in ctx          # 原表格仍在
    assert "能力画像" in ctx              # 画像段被追加
    assert "芯片调研" in ctx


def test_capability_context_no_profiles_unchanged_tail(monkeypatch, db_session, workspace):
    from src.service.agent.orchestrator import prompts
    from tests.conftest import add_employee
    add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(prompts, "_read_employee_profile", lambda eid: "")
    ctx = prompts.build_employee_capability_context(db_session, workspace.id)
    assert "| ID | 姓名" in ctx
    assert "能力画像" not in ctx          # 无 profile→不加段
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_profile_routing.py -k capability_context -v`

- [ ] **Step 3: 实现**

`build_employee_capability_context` 末尾 `return "\n".join(lines)` 改为：
```python
    table = "\n".join(lines)
    profiles_section = build_employee_profiles_section(employees)
    if profiles_section:
        return table + "\n\n" + profiles_section
    return table
```
（`employees` 变量在函数内已有，复用它。）

- [ ] **Step 4: 跑测试 + 回归**
Run: `cd apps/server && uv run pytest tests/test_profile_routing.py -v`
然后 `cd apps/server && uv run pytest tests/ -k "employee or orchestrat or prompt or profile"`（无新增回归；预存基线判断区分）

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/tests/test_profile_routing.py
git commit -m "feat(learning): build_employee_capability_context 注入员工能力画像（闭合学习闭环）"
```

---

## 收尾验证
- [ ] 全量后端：`cd apps/server && uv run pytest tests/ -q`，仅预存基线、零新增回归。
- [ ] 手测桩：某员工攒够任务有 profile.md 后，总管 `list_workspace_employees` 返回里能看到该员工能力画像，组队时按画像选人。

## 开放问题
- O1 profile 太长是否截断：v1 不截(profile 本就简短 3-6 条)；若实测过长再截。
- O2 画像段位置：本版放表格后。若总管更关注画像可前置，按手测体感调。
</content>
