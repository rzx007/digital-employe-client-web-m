# 技能预路由（关键词软提示）实现计划

> **For agentic workers:** 用 superpowers:executing-plans 或 subagent-driven-development 逐任务执行。步骤用 `- [ ]`。

**Goal:** 在 LLM 判断之前加一道确定性关键词匹配，命中内置技能则把软提示拼到用户消息尾部，提升技能识别一致性；默认开、可关、不碰系统前缀（不伤 prefill）。

**Architecture:** 新增纯函数模块 `skill_prerouter.py`（关键词表 + match + hint）；`chat_service.py` employee 分支注入；新增 `agent_skill_preroute` 配置。

**Tech Stack:** Python / pytest。Spec：`docs/superpowers/specs/2026-06-09-skill-preroute-design.md`。

测试命令：`cd apps/server && uv run pytest <path> -q`

---

## Task 1: `skill_prerouter` 模块（纯函数，TDD）

**Files:**
- Create: `apps/server/src/service/agent/skill_prerouter.py`
- Test: `apps/server/tests/test_skill_prerouter.py`

- [ ] **Step 1: 写失败测试** `apps/server/tests/test_skill_prerouter.py`:

```python
from src.service.agent.skill_prerouter import (
    match_skills,
    build_route_hint,
)

AVAIL = ["bug-reporter", "docx", "pptx", "feishu-workbench"]


def test_match_hit_and_intersect_available():
    assert match_skills("我想反馈个bug", AVAIL) == ["bug-reporter"]


def test_match_skips_skill_not_available():
    # 命中 env-steward 关键词，但它不在 available -> 不返回
    assert match_skills("帮我装python", ["docx", "pptx"]) == []


def test_match_case_insensitive_substring():
    assert "pptx" in match_skills("做个 PPT", AVAIL)


def test_match_no_hit_returns_empty():
    assert match_skills("今天天气怎么样", AVAIL) == []


def test_match_limit_and_stable_order():
    out = match_skills("交易日历的ppt", AVAIL, limit=1)
    assert len(out) == 1


def test_build_route_hint_empty():
    assert build_route_hint([]) == ""


def test_build_route_hint_contains_skill_and_path():
    h = build_route_hint(["bug-reporter"])
    assert "bug-reporter" in h and "/skills/" in h
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_skill_prerouter.py -q` → FAIL（模块不存在）

- [ ] **Step 3: 实现** `apps/server/src/service/agent/skill_prerouter.py`:

```python
"""技能预路由：确定性关键词匹配 -> 软提示（注入用户消息尾部，不碰系统前缀）。"""
from __future__ import annotations

from typing import Iterable

# 内置技能 -> 触发关键词（全小写）。刻意避免「文档/表格」等过宽词，宁可少提示。
SKILL_TRIGGERS: dict[str, tuple[str, ...]] = {
    "bug-reporter": (
        "反馈", "报bug", "报错", "提建议", "吐槽", "问题反馈", "提个意见", "想反馈",
    ),
    "feishu-workbench": ("交易日", "交易日历", "休市", "开市"),
    "pptx": ("ppt", "幻灯片", "演示文稿", "slides", "deck"),
    "html-ppt": ("ppt", "幻灯片", "演示文稿", "slides", "deck"),
    "xlsx": ("excel", "电子表格", "xlsx", "csv"),
    "pdf": ("pdf",),
    "docx": ("word文档", ".docx", "word 文件"),
    "env-steward": (
        "装python", "装node", "缺依赖", "modulenotfound", "pip装不上",
        "配镜像", "环境依赖",
    ),
    "doc-coauthoring": (
        "技术方案", "标书", "投标", "可行性报告", "白皮书", "长报告", "需求文档",
    ),
}


def match_skills(
    user_text: str,
    available_skills: Iterable[str],
    limit: int = 2,
) -> list[str]:
    """子串匹配命中、且技能在 available 内的技能名，按命中关键词最长降序、名升序，取前 limit。"""
    text = (user_text or "").lower()
    avail = set(available_skills)
    scored: list[tuple[int, str]] = []
    for skill, kws in SKILL_TRIGGERS.items():
        if skill not in avail:
            continue
        best = 0
        for kw in kws:
            if kw and kw.lower() in text:
                best = max(best, len(kw))
        if best > 0:
            scored.append((best, skill))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [s for _, s in scored[:limit]]


def build_route_hint(matched: list[str]) -> str:
    """命中技能 -> 软提示串（尾部注入）；空 -> 空串。"""
    if not matched:
        return ""
    names = "、".join(matched)
    return (
        f"\n\n【技能路由提示（系统自动匹配，仅供参考）】本条消息可能匹配技能：{names}。"
        "若相关，请先读对应 /skills/<技能名>/SKILL.md 并按其说明执行；"
        "你判断不相关可忽略本提示。"
    )
```

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_skill_prerouter.py -q` → PASS（7 passed）

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/service/agent/skill_prerouter.py apps/server/tests/test_skill_prerouter.py
git commit -m "feat(preroute): add skill_prerouter (keyword match + soft hint)"
```

---

## Task 2: 配置 `agent_skill_preroute`

**Files:**
- Modify: `apps/server/src/core/config.py`
- Test: `apps/server/tests/test_preroute_config.py`

- [ ] **Step 1: 写失败测试** `apps/server/tests/test_preroute_config.py`:
```python
def test_settings_has_agent_skill_preroute_default_true():
    from dataclasses import fields
    from src.core.config import Settings

    f = {x.name: x for x in fields(Settings)}
    assert "agent_skill_preroute" in f
    assert f["agent_skill_preroute"].default is True
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_preroute_config.py -q` → FAIL

- [ ] **Step 3: 实现** in `config.py`:
1. `Settings` dataclass 加字段：`agent_skill_preroute: bool = True`
2. `get_settings()` 解析区加：`agent_skill_preroute = _get_kv_bool(kv_data, "AGENT_SKILL_PREROUTE", default=True)`
   （⚠️ `_get_kv_bool` 默认 False，**必须显式 `default=True`**。参照现有 `_get_kv_bool` 调用，如 `agent_serial_mode`。）
3. Settings 构造处加：`agent_skill_preroute=agent_skill_preroute,`

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_preroute_config.py -q` → PASS

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/core/config.py apps/server/tests/test_preroute_config.py
git commit -m "feat(preroute): add AGENT_SKILL_PREROUTE setting (default true)"
```

---

## Task 3: 注入点接线（chat_service employee 分支）

**Files:**
- Modify: `apps/server/src/service/chat_service.py`（`:835-841` 区，employee 分支）

- [ ] **Step 0: 定位** `grep -n "request_messages.append" apps/server/src/service/chat_service.py` 找到 `:841` 这一行；确认其上方 `skills_path`（employee 分支，~:806）与 `question`、`skill_name`、`target_type` 在作用域内。

- [ ] **Step 1: 加 import**（文件顶部 import 区）：
```python
from src.service.agent.paths import resolve_skills_root, list_available_skills
from src.service.agent.skill_prerouter import match_skills, build_route_hint
```
（若 `paths` 已部分导入则合并。）

- [ ] **Step 2: 实现注入**——在 `request_messages.append({"role": "user", "content": user_content})`（`:841`）**之前**插入：
```python
            # 技能预路由（软提示，尾部注入；不碰系统前缀=不伤 prefill）。仅 employee
            # 自动模式（未显式 skill_name）；任何异常退化为不注入，绝不影响正常对话。
            try:
                if (
                    target_type == "employee"
                    and get_settings().agent_skill_preroute
                    and not skill_name
                ):
                    _avail = list_available_skills(resolve_skills_root(skills_path))
                    _hint = build_route_hint(match_skills(question, _avail))
                    if _hint:
                        user_content = f"{user_content}{_hint}"
            except Exception:
                logger.warning("skill preroute failed, skip", exc_info=True)
```
（确认 `get_settings` 已在该文件导入/可用；`skills_path` 是 employee 分支变量。）

- [ ] **Step 3: 冒烟**
Run: `cd apps/server && uv run python -c "import src.service.chat_service; print('import OK')"` → import OK
（确保 import/语法无误。注入逻辑无独立单元测试——它依赖请求上下文；正确性由 Task 1 的 match/hint 单测 + 此 import 冒烟 + 人工对话验证保证。）

- [ ] **Step 4: Commit**
```bash
git add apps/server/src/service/chat_service.py
git commit -m "feat(preroute): inject skill route hint into employee user message tail"
```

---

## Task 4: 回归 + 人工验证说明

- [ ] **Step 1: 跑预路由相关测试**
Run: `cd apps/server && uv run pytest tests/test_skill_prerouter.py tests/test_preroute_config.py -q` → 全 PASS

- [ ] **Step 2: 确认无回归**（导入面）
Run: `cd apps/server && uv run python -c "import src.service.chat_service, src.core.config; print('ok')"`

- [ ] **Step 3: 人工验证（重启后端后）**
给某员工发"我想反馈个bug"/"帮我做个ppt"等，观察是否更稳定地走对应技能；发无关话不应出现误提示。`AGENT_SKILL_PREROUTE=0` 可一键关。

---

## 注意
- 生效需**重启后端**（chat_service/config 由进程加载）。
- 软提示在用户消息尾部，系统前缀不变 → prefill 前缀缓存不受影响。
- v1 仅 employee；curator/group 不接入（见 spec §1）。
