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
        excluded_tools=frozenset({"execute"}),
        tool_description_overrides={
            "shell_execute": (
                "在 shell 中执行命令（替代 execute）。command 为真实物理路径。"
                "intent 可选：20字内中文，写业务目的（如：验证示例代码输出）。"
                "禁止出现文件名/路径/「执行」字样；勿加引号。"
            ),
        },
    ),
)

_CHECKPOINTER: AsyncSqliteSaver | MemorySaver | None = None


def init_checkpointer(conn) -> None:
    """初始化全局的检查点保存器"""
    global _CHECKPOINTER
    _CHECKPOINTER = AsyncSqliteSaver(conn)


def get_checkpointer() -> AsyncSqliteSaver | MemorySaver:
    """获取全局的检查点保存器。

    HITL resume 依赖持久 checkpointer。除测试环境外，未初始化时必须
    明确失败，避免悄悄退化到进程内 MemorySaver。
    """
    global _CHECKPOINTER
    if _CHECKPOINTER is None:
        if get_settings().environment == "test":
            logger.warning("AsyncSqliteSaver 未初始化，测试环境回退到 MemorySaver")
            _CHECKPOINTER = MemorySaver()
        else:
            raise RuntimeError("LangGraph AsyncSqliteSaver 未初始化")
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
