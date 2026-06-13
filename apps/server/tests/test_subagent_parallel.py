"""单员工内部并行子任务（deepagents task 工具）相关回归测试。

覆盖：
  1. 设置项 subagent_max_parallel 默认 = 3，且解析器健壮
  2. 安全 profile：task 重开（general_purpose enabled）且 execute 仍被排除（子代理同管控）
  3. 并发信号量中间件确实把同一父会话的并行子任务限到上限
"""

from __future__ import annotations

import asyncio

import pytest


# ---------- 1. 设置项 ----------

def test_settings_has_subagent_max_parallel_default_3():
    from dataclasses import fields
    from src.core.config import Settings

    f = {x.name: x for x in fields(Settings)}
    assert "subagent_max_parallel" in f
    assert f["subagent_max_parallel"].default == 3


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, 3),      # 缺省
        ("", 3),        # 空串（_get_kv_value 会先归一成 None，这里直接给空串也应回退）
        ("5", 5),       # 正常
        ("0", 1),       # 下限 1
        ("-2", 1),      # 负数→1
        ("abc", 3),     # 非法→default
    ],
)
def test_parse_subagent_max_parallel(raw, expected):
    from src.core.config import _parse_subagent_max_parallel

    # 空串走 int("") 抛 ValueError → default，符合预期
    assert _parse_subagent_max_parallel(raw) == expected


# ---------- 2. 安全 profile：task 重开 + execute 仍排除 ----------

def test_safety_profile_reopens_task_but_excludes_execute():
    """走真实模型实例解析 profile，断言 general_purpose 开、execute 排除。

    这是子代理安全边界的核心保证：子代理继承 excluded_tools，故也拿不到内置 execute、
    只能走受管 shell_execute。
    """
    import src.service.agent.checkpointer  # noqa: F401  触发 profile 注册
    from src.llm.factory import build_chat_model
    from deepagents.profiles.harness.harness_profiles import (
        _harness_profile_for_model,
    )

    model = build_chat_model()
    profile = _harness_profile_for_model(model, None)

    # task 重开
    gp = profile.general_purpose_subagent
    assert gp is not None
    assert gp.enabled is True, "general-purpose 子代理应已重开（task 工具暴露）"

    # execute 仍被排除（主 agent 与子代理共用此排除）
    assert "execute" in profile.excluded_tools, (
        "execute 必须仍在 excluded_tools，否则子代理可绕过受管 shell_execute"
    )


# ---------- 3. 并发信号量中间件 ----------

def test_subagent_concurrency_middleware_bounds_parallelism():
    """同一父会话内并发跑 N>limit 个子代理模型调用，断言峰值并发 ≤ limit。"""
    from src.service.agent.subagent_concurrency import (
        SubagentConcurrencyMiddleware,
        _SEMAPHORES,
    )

    _SEMAPHORES.clear()
    limit = 2
    mw = SubagentConcurrencyMiddleware(limit=limit)

    # 构造一个假 request，runtime.config 带同一 thread_id
    class _Runtime:
        config = {"configurable": {"thread_id": "conv-test"}}

    class _Req:
        runtime = _Runtime()

    state = {"current": 0, "peak": 0}

    async def _handler(_req):
        state["current"] += 1
        state["peak"] = max(state["peak"], state["current"])
        await asyncio.sleep(0.05)  # 模拟模型调用耗时
        state["current"] -= 1
        return "ok"

    async def _run():
        tasks = [
            mw.awrap_model_call(_Req(), _handler) for _ in range(6)
        ]
        return await asyncio.gather(*tasks)

    results = asyncio.run(_run())
    assert results == ["ok"] * 6
    assert state["peak"] <= limit, f"峰值并发 {state['peak']} 超过上限 {limit}"


def test_subagent_concurrency_isolated_per_thread():
    """不同父会话各自独立信号量，互不阻塞。"""
    from src.service.agent.subagent_concurrency import (
        SubagentConcurrencyMiddleware,
        _SEMAPHORES,
    )

    _SEMAPHORES.clear()
    mw = SubagentConcurrencyMiddleware(limit=1)

    def _req_for(tid):
        class _Runtime:
            config = {"configurable": {"thread_id": tid}}

        class _Req:
            runtime = _Runtime()

        return _Req()

    state = {"current": 0, "peak": 0}

    async def _handler(_req):
        state["current"] += 1
        state["peak"] = max(state["peak"], state["current"])
        await asyncio.sleep(0.05)
        state["current"] -= 1
        return "ok"

    async def _run():
        # 两个不同会话各 1 个：limit=1 但因 thread 不同应能同时跑 → peak=2
        return await asyncio.gather(
            mw.awrap_model_call(_req_for("conv-A"), _handler),
            mw.awrap_model_call(_req_for("conv-B"), _handler),
        )

    asyncio.run(_run())
    assert state["peak"] == 2, "不同父会话应各自独立、可同时跑"
