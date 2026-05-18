import logging

from dotenv import load_dotenv
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    register_harness_profile,
)
from src.core.config import get_settings

load_dotenv()

logger = logging.getLogger(__name__)

# 禁用 deepagents 内置通用子代理（task tool），避免代理在未授权情况下
# 通过 task tool 调用子代理来执行 shell 命令等操作
_settings = get_settings()
register_harness_profile(
    f"openai:{_settings.deepagent_model or 'qwen2.5-72b-instruct'}",
    HarnessProfile(
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
        excluded_middleware={"SummarizationMiddleware"},
    ),
)

_CHECKPOINTER: AsyncSqliteSaver | MemorySaver | None = None


def init_checkpointer(conn) -> None:
    """初始化全局的检查点保存器"""
    global _CHECKPOINTER
    _CHECKPOINTER = AsyncSqliteSaver(conn)


def get_checkpointer() -> AsyncSqliteSaver | MemorySaver:
    """获取全局的检查点保存器，如果未初始化则回退到 MemorySaver"""
    global _CHECKPOINTER
    if _CHECKPOINTER is None:
        logger.warning("AsyncSqliteSaver 未初始化，回退到 MemorySaver")
        _CHECKPOINTER = MemorySaver()
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
