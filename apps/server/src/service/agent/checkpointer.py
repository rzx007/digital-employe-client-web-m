import logging
import os
from typing import Any

from dotenv import load_dotenv
from langgraph.checkpoint.memory import MemorySaver

from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    register_harness_profile,
)
from src.core.config import get_settings

load_dotenv()

logger = logging.getLogger(__name__)

# 开启 deepagents 内置通用子代理（task tool），支持「单员工内部并行子任务」：
# 员工可在一轮里发出多个 task() 把相互独立的活并行跑（见
# docs/superpowers/specs/2026-06-13-employee-parallel-subtasks-design.md）。
#
# 安全边界保持不变：`excluded_tools={"execute"}` 同时作用于主 agent 与子代理
# （deepagents graph.py:677-678 给 general-purpose 子代理也挂 _ToolExclusionMiddleware），
# 因此子代理也拿不到内置 execute、只能走受管 shell_execute（带 intent/审计）。
# 这化解了当初禁用 task 的顾虑：不是「禁止子代理执行」，而是「子代理执行也必须
# 经过受管 shell_execute 同一道门」。
_settings = get_settings()
# extra_middleware 用工厂形式：deepagents 给 general-purpose 子代理栈应用它
# （graph.py:674 materialize_extra_middleware），从而给子任务模型调用挂并发信号量。
# 工厂在每次构图时调用，能读到最新的 subagent_max_parallel 设置。
from src.service.agent.subagent_concurrency import (  # noqa: E402
    build_subagent_concurrency_middleware,
)

register_harness_profile(
    f"openai:{_settings.deepagent_model or 'qwen2.5-72b-instruct'}",
    HarnessProfile(
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=True),
        excluded_middleware={"SummarizationMiddleware"},
        excluded_tools=frozenset({"execute"}),
        extra_middleware=build_subagent_concurrency_middleware,
        tool_description_overrides={
            "shell_execute": (
                "在 shell 中执行命令（替代 execute）。command 为真实物理路径。"
                "intent 可选：20字内中文，写业务目的（如：验证示例代码输出）。"
                "禁止出现文件名/路径/「执行」字样；勿加引号。"
            ),
        },
    ),
)

_CHECKPOINTER: Any = None


def init_checkpointer(conn=None, checkpoints_dir=None) -> None:
    """初始化全局的检查点保存器。

    按 ``settings.checkpointer_backend`` 选实现：
    - ``file``（默认）：``FileCheckpointSaver(checkpoints_dir)``，per-thread 文件，
      消除群聊并发流共享单 sqlite 连接的串行瓶颈。
    - ``sqlite``（回滚老路径）：``AsyncSqliteSaver(conn)``。
    """
    global _CHECKPOINTER
    backend = get_settings().checkpointer_backend
    if backend == "sqlite":
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        _CHECKPOINTER = AsyncSqliteSaver(conn)
    else:
        from src.service.agent.file_checkpointer import FileCheckpointSaver

        _CHECKPOINTER = FileCheckpointSaver(checkpoints_dir)


def init_memory_checkpointer() -> None:
    """测试 / eval 等无持久 SQLite 场景使用进程内 MemorySaver。"""
    global _CHECKPOINTER
    _CHECKPOINTER = MemorySaver()


def _allows_memory_fallback() -> bool:
    env = os.getenv("ENVIRONMENT", "").strip().lower()
    if env == "test":
        return True
    return bool(os.getenv("PYTEST_CURRENT_TEST"))


def get_checkpointer() -> Any:
    """获取全局的检查点保存器。

    HITL resume 依赖持久 checkpointer。除测试环境外，未初始化时必须
    明确失败，避免悄悄退化到进程内 MemorySaver。
    """
    global _CHECKPOINTER
    if _CHECKPOINTER is None:
        if _allows_memory_fallback():
            logger.warning("checkpointer 未初始化，测试环境回退到 MemorySaver")
            _CHECKPOINTER = MemorySaver()
        else:
            raise RuntimeError("LangGraph checkpointer 未初始化")
    return _CHECKPOINTER


async def delete_conversation_checkpoint(conversation_id: int) -> None:
    """删除 LangGraph 中与 conversation_id 对应的 thread checkpoint。"""
    checkpointer = get_checkpointer()
    if not hasattr(checkpointer, "adelete_thread"):
        logger.warning(
            "checkpointer has no adelete_thread, skip cleanup conv=%s",
            conversation_id,
        )
        return
    try:
        await checkpointer.adelete_thread(str(conversation_id))
        logger.info("Deleted LangGraph checkpoint for conversation %s", conversation_id)
    except Exception:
        logger.warning(
            "Failed to delete LangGraph checkpoint for conversation %s",
            conversation_id,
            exc_info=True,
        )
