"""子任务并发限流中间件（单员工内部并行子任务）。

deepagents 的 `task` 工具让员工在一轮里 fan-out 多个子任务并行跑。这些子任务在
「一个已准入的会话流」内部并发执行，**绕过** registry 的会话级槽阀门
（`can_admit`/`MAX_CONCURRENT_PER_EMPLOYEE`）。若一次 fan-out 太多，单槽下会有多路
嵌套图同时打 LLM，可能把昇腾单卡 GPU 槽打满（见
docs/superpowers/specs/2026-06-13-employee-parallel-subtasks-design.md 单元 B，
以及运维记录的 vLLM 单卡抢占）。

本中间件给**子代理的每次模型调用**套一个 per-thread `asyncio.Semaphore(N)`，N 由
`settings.subagent_max_parallel`（默认 3）控制。挂在 general-purpose 子代理的
middleware 栈上（经 HarnessProfile.extra_middleware），不影响主 agent。

限流维度 = thread_id（父会话）。同一父会话的子任务共享一个信号量；不同会话互不影响。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware.types import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
)

logger = logging.getLogger(__name__)

# per-thread 信号量缓存。键 = thread_id（父会话 id 字符串）。
# 进程内全局，随会话自然累积；条目极轻量（一个 Semaphore），不主动清理。
_SEMAPHORES: dict[str, asyncio.Semaphore] = {}


def _resolve_thread_id(request: ModelRequest[Any]) -> str:
    """从模型请求的 runtime config 取 thread_id（父会话）。取不到回退到 'default'。"""
    try:
        cfg = getattr(request, "runtime", None)
        cfg = getattr(cfg, "config", None) if cfg is not None else None
        if isinstance(cfg, dict):
            configurable = cfg.get("configurable") or {}
            tid = configurable.get("thread_id")
            if tid is not None:
                return str(tid)
    except Exception:  # noqa: BLE001
        pass
    return "default"


def _get_semaphore(thread_id: str, limit: int) -> asyncio.Semaphore:
    sem = _SEMAPHORES.get(thread_id)
    if sem is None:
        sem = asyncio.Semaphore(max(1, limit))
        _SEMAPHORES[thread_id] = sem
    return sem


class SubagentConcurrencyMiddleware(AgentMiddleware[Any, Any, Any]):
    """限制单父会话内并行子任务（子代理模型调用）的并发数。

    只在子代理栈上生效（经 HarnessProfile.extra_middleware 注入 general-purpose）。
    同步路径不限流（子任务并行只发生在 async `atask`/ToolNode 路径），仅实现 async。
    """

    def __init__(self, *, limit: int) -> None:
        super().__init__()
        self._limit = max(1, int(limit))

    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        # 同步路径不会有真并发子任务（asyncio.gather 走 async），直接透传。
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        thread_id = _resolve_thread_id(request)
        sem = _get_semaphore(thread_id, self._limit)
        # 信号量满则在此 await 排队，不拒绝——多出的子任务顺序执行，不绕过 GPU 保护。
        async with sem:
            return await handler(request)


def build_subagent_concurrency_middleware() -> list[AgentMiddleware[Any, Any, Any]]:
    """工厂：供 HarnessProfile.extra_middleware 使用（每次构图时读最新设置）。"""
    from src.core.config import get_settings

    limit = get_settings().subagent_max_parallel
    logger.info("subagent concurrency limit = %s (per parent conversation)", limit)
    return [SubagentConcurrencyMiddleware(limit=limit)]
