# 解耦 LLM read 超时扛长任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 LLM 的 httpx read 超时从 90s 硬限解耦为 None，让长命令/长任务期间不被底层 HTTP 误杀，判死交给应用层 900s no_content 活动看门狗；并补两处兜底（error 文案识别 timeout、失败保留已产出正文）。

**Architecture:** 后端三处独立改动。①`factory.py` 的 `read_timeout` 从 `min(90,...)` 改 None（仅改 read，connect/write/pool 不动）。②`error_messages.py` 空异常分支加按异常类型名识别 timeout。③`stream_registry.py` error 收尾的 partial_text 与 completed 路径口径一致、保留 assistant 正文。各自带测试。

**Tech Stack:** Python FastAPI + httpx + pytest（`cd apps/server && uv run pytest`）。

**关联 spec:** `docs/superpowers/specs/2026-06-19-long-task-read-timeout-decouple-design.md`

**前置已确认事实（代码核查，dev 分支）：**
- `apps/server/src/llm/factory.py`：`build_chat_model(...)`(:93) 内 `read_timeout = min(90.0, req_timeout)`(:137) → `llm_timeout = httpx.Timeout(connect=connect_cap, read=read_timeout, write=30.0, pool=connect_cap)`(:138-143) → `ChatOpenAI(..., timeout=llm_timeout, ...)`(:151-167)。注释 :132-136 解释旧 90s 设计。返回的 ChatOpenAI 把 httpx.Timeout 存在其 `timeout` 属性（可断言 `.read`/`.connect`）。建模型不发网络（惰性 client），可在测试里直接 build 并查 timeout。`max_retries=2`(:160) 保留。
- `apps/server/src/service/agent/error_messages.py`：`format_agent_error_for_user(exc: BaseException | str)`(:17)。`raw = str(exc).strip() if exc is not None else ""`(:19)。`if not raw: return "任务执行失败，请稍后重试。"`(:20-21)——`httpx.ReadTimeout` 的 str() 为空命中此分支，到不了 :33 的 timeout 分支。`_active_model_label()`(:6) 可用。
- `apps/server/src/service/stream_registry.py`：error 分支 `except Exception as e:`(:2161)，`partial_text = latest_updates_text or None`(:2173)。completed/其它路径用 `latest_updates_text or "".join(assistant_text_parts)`(:2147-2148)。`assistant_text_parts: list[str]`(:1635)、`latest_updates_text`(:1636) 在 run 协程作用域。
- 测试：`apps/server/tests/test_agent_error_messages.py`（直接调 `format_agent_error_for_user`，风格简单）。`apps/server/tests/` 下 factory 无专测（有 test_llm_registry_bootstrap/test_llm_vision）。

**测试命令：** `cd apps/server && uv run pytest tests/<file> -v`

---

## File Structure

- Modify `apps/server/src/llm/factory.py` — read_timeout 解耦（Task 1）。
- Create `apps/server/tests/test_llm_factory_timeout.py` — read=None 断言（Task 1）。
- Modify `apps/server/src/service/agent/error_messages.py` + `apps/server/tests/test_agent_error_messages.py` — 空异常 timeout 识别（Task 2）。
- Modify `apps/server/src/service/stream_registry.py` — error partial 保留正文（Task 3，含测试或审查覆盖）。

---

## Task 1: 解耦 read_timeout（核心）

**Files:**
- Modify: `apps/server/src/llm/factory.py:132-143`
- Create: `apps/server/tests/test_llm_factory_timeout.py`

- [ ] **Step 1: 读现状 + 确认可测**

读 `factory.py:93-167`（`build_chat_model`），确认 `read_timeout`/`llm_timeout` 构造与返回 ChatOpenAI 的 `timeout` 属性。试在 Python 里 `build_chat_model(...)` 看构造是否需要真实 settings/网络——若需要，测试用最小参数 + monkeypatch settings（参考 test_llm_vision/test_llm_registry_bootstrap 怎么造 settings）。

- [ ] **Step 2: 写失败测试**

新建 `apps/server/tests/test_llm_factory_timeout.py`：

```python
from src.llm.factory import build_chat_model


def test_read_timeout_is_none_connect_write_pool_finite():
    # build_chat_model 不发网络（惰性 client），可直接构造并查 timeout。
    chat = build_chat_model(model="gpt-test", base_url="http://localhost:9999/v1", api_key="sk-x")
    t = chat.timeout  # httpx.Timeout
    assert t.read is None, f"read 应解耦为 None，实际 {t.read}"
    # 其余三项仍为有限值，不被放大
    assert t.connect is not None and t.connect <= 12.0
    assert t.write is not None
    assert t.pool is not None
```
（`build_chat_model` 的入参按其真实签名填——读 :93 的 def 行确认参数名/必填项；上面 model/base_url/api_key 是常见形态，按实际调整。若 `chat.timeout` 不是直接的 httpx.Timeout（被 langchain 包装），改为断言 langchain 暴露的等价字段，或断言 build_chat_model 内部计算出的 read_timeout——必要时把 read_timeout 计算抽成可单测的小函数 `_compute_read_timeout()` 返回 None 并测它，但优先直接查 chat.timeout。）

- [ ] **Step 3: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_llm_factory_timeout.py -v`
Expected: FAIL —— 当前 `read = min(90, req_timeout)` 为 90.0 不是 None。

- [ ] **Step 4: 实现解耦**

把 `factory.py:132-143` 改为（read 改 None，注释更新，connect/write/pool 不动）：
```python
    req_timeout = max(15.0, float(settings.llm_request_timeout))
    connect_cap = min(12.0, req_timeout)
    # read 超时 = 流式「两个 chunk 之间」的最长等待。设 None（无限）：判「模型是否挂死」
    # 完全交给应用层「看活动」看门狗——长命令/长任务期间工具 stdout + 30s 心跳持续刷新
    # 活动时间戳，不会被底层 HTTP 误杀；模型真挂死（连续无任何活动）由 stream_registry 的
    # 900s no_content watchdog cancel 回收。connect/write/pool 仍有限，不放大。
    read_timeout = None
    llm_timeout = httpx.Timeout(
        connect=connect_cap,
        read=read_timeout,
        write=30.0,
        pool=connect_cap,
    )
```

- [ ] **Step 5: 运行,确认转绿 + 既有 llm 测试不回归**

Run: `cd apps/server && uv run pytest tests/test_llm_factory_timeout.py tests/test_llm_registry_bootstrap.py tests/test_llm_vision.py -v`
Expected: PASS（新测试绿；既有 llm 测试不受 read 改动影响）。

- [ ] **Step 6: 提交（dev）**

```bash
git add apps/server/src/llm/factory.py apps/server/tests/test_llm_factory_timeout.py
git commit -m "fix(server): LLM read_timeout解耦为None,长任务交给应用层活动看门狗判死(修90s误杀)"
```

---

## Task 2: error 文案识别 timeout 类异常

**Files:**
- Modify: `apps/server/src/service/agent/error_messages.py:17-21`
- Modify: `apps/server/tests/test_agent_error_messages.py`

- [ ] **Step 1: 写失败测试（追加）**

在 `tests/test_agent_error_messages.py` 追加：
```python
def test_empty_str_timeout_exception_gives_readable_message():
    import httpx
    from src.service.agent.error_messages import format_agent_error_for_user

    # httpx.ReadTimeout 的 str() 常为空 → 旧逻辑落到泛化「任务执行失败」。
    exc = httpx.ReadTimeout("")
    msg = format_agent_error_for_user(exc)
    assert "超时" in msg
    assert "任务执行失败" not in msg


def test_empty_str_non_timeout_exception_keeps_generic():
    from src.service.agent.error_messages import format_agent_error_for_user

    class WeirdError(Exception):
        def __str__(self):
            return ""

    msg = format_agent_error_for_user(WeirdError())
    assert msg == "任务执行失败，请稍后重试。"
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_agent_error_messages.py -v`
Expected: `test_empty_str_timeout_exception...` FAIL —— 当前空 str 直接返回「任务执行失败」，不含「超时」。`test_empty_str_non_timeout...` 可能已 PASS。

- [ ] **Step 3: 实现**

把 `error_messages.py:20-21` 的：
```python
    if not raw:
        return "任务执行失败，请稍后重试。"
```
改为：
```python
    if not raw:
        type_name = (
            type(exc).__name__ if isinstance(exc, BaseException) else ""
        )
        if "timeout" in type_name.lower() or "timedout" in type_name.lower():
            return f"模型 {_active_model_label()} 流式响应超时，请稍后重试。"
        return "任务执行失败，请稍后重试。"
```
（`_active_model_label` 已在文件内 :6；不动其余非空分支逻辑。）

- [ ] **Step 4: 运行,确认转绿**

Run: `cd apps/server && uv run pytest tests/test_agent_error_messages.py -v`
Expected: PASS（两新用例 + 既有 connection/tool-too-large 等用例不回归）。

- [ ] **Step 5: 提交（dev）**

```bash
git add apps/server/src/service/agent/error_messages.py apps/server/tests/test_agent_error_messages.py
git commit -m "fix(server): error文案按异常类型名识别timeout,空str不再泛化为任务执行失败"
```

---

## Task 3: error 收尾保留已产出 assistant 正文

**Files:**
- Modify: `apps/server/src/service/stream_registry.py:2173`

- [ ] **Step 1: 确认两处口径差异**

读 `stream_registry.py:2147-2148`（completed/其它路径：`latest_updates_text or "".join(assistant_text_parts)`）与 `:2173`（error 分支：`partial_text = latest_updates_text or None`）。确认 error 分支丢了 `assistant_text_parts`。

- [ ] **Step 2: 改 error 分支与 sibling 口径一致**

把 `:2173` 的：
```python
            partial_text = latest_updates_text or None
```
改为：
```python
            partial_text = latest_updates_text or ("".join(assistant_text_parts) or None)
```
（与 :2147-2148 同口径：优先 latest_updates_text，否则已累积的 assistant 正文，再否则 None。`assistant_text_parts` 在该作用域内 :1635 定义、:1934 累积。）

- [ ] **Step 3: 验证（审查 + 既有测试）**

`stream_registry` 的 run 协程难以纯单测（重 IO/异步）。本步以代码审查为主：确认 `assistant_text_parts` 在 :2173 作用域可见、改动与 :2147-2148 一致。
Run: `cd apps/server && uv run pytest tests/ -k "stream or registry or stale" -v`
Expected: PASS（若有相关测试；无相关测试则确认未引入导入/语法错误，跑 `python -c "import src.service.stream_registry"` 不报错 —— 实际用 `cd apps/server && uv run python -c "import src.service.stream_registry"`）。

- [ ] **Step 4: typecheck/import 冒烟**

Run: `cd apps/server && uv run python -c "import src.service.stream_registry; print('ok')"`
Expected: 打印 ok，无 ImportError/SyntaxError。

- [ ] **Step 5: 提交（dev）**

```bash
git add apps/server/src/service/stream_registry.py
git commit -m "fix(server): error收尾partial_text保留已产出assistant正文,与completed路径口径一致(不丢数据)"
```

---

## Self-Review

**Spec coverage:**
- 改动1（read_timeout 解耦为 None，仅改 read，connect/write/pool 不动，更新注释）→ Task 1。✓
- 改动2（error 文案空 str 分支按异常类型名识别 timeout）→ Task 2。✓
- 改动3（error partial_text 保留 assistant_text_parts，与 :2147-2148 口径一致）→ Task 3。✓
- 不在本期范围（后台句柄、connect/write/pool、no_content 900s）→ 计划未涉及。✓
- 测试（factory read=None / error timeout 文案 / error partial 保留正文 + 各自不回归）→ Task 1/2/3 各步。✓

**Placeholder scan:** Task 1 Step 2 有「按真实签名调整 build_chat_model 入参 / 若 chat.timeout 被包装则改断言方式」——这是对「构造函数真实签名 + langchain 是否包装 timeout」的合理适配指示（给了首选断言 chat.timeout.read is None + 退路），非占位 TODO；Task 3 Step 3 明说「难纯单测、以审查+import 冒烟覆盖」是诚实的测试策略说明，非逃避。无 "TBD"。

**Type consistency:** `read_timeout = None`（Task 1）与 `httpx.Timeout(read=read_timeout)` 一致（httpx.Timeout 接受 read=None 表无限）；`format_agent_error_for_user(exc)` 用 `type(exc).__name__`（Task 2）与既有签名 `exc: BaseException | str` 一致（加 isinstance 守卫）；`partial_text` 表达式（Task 3）与 :2147-2148 同形，`assistant_text_parts`/`latest_updates_text` 命名一致。
