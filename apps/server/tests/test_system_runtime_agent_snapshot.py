from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.core.agent_runtime_policy import AgentRuntimePolicy
from src.service.agent_stream_queue import PendingStart
from src.service.stream_registry import ActiveStreamTask, StreamRegistry


def _pending(conv_id: int, source: str = "scheduled") -> PendingStart:
    return PendingStart(
        conversation_id=conv_id,
        agent=object(),
        messages=[],
        config={"configurable": {"thread_id": conv_id}},
        stream_msg_id=conv_id * 10,
        skill_name="",
        debug_content_only=False,
        priority=30,
        source=source,
    )


def test_snapshot_lists_active_and_queued() -> None:
    reg = StreamRegistry()
    reg._tasks[1] = ActiveStreamTask(1, source="user_chat")
    reg._tasks[1].status = "streaming"
    mock_task = MagicMock()
    mock_task.done.return_value = False
    reg._tasks[1]._asyncio_task = mock_task

    reg._queue.enqueue(_pending(2, "scheduled"))
    reg._tasks[2] = ActiveStreamTask(2, source="scheduled")
    reg._tasks[2].status = "queued"

    with patch(
        "src.service.stream_registry._resolve_conversation_titles",
        return_value={1: "会话甲", 2: "任务乙"},
    ):
        snap = reg.snapshot_agent_runtime_status(preview_limit=5)

    assert len(snap["active_items"]) == 1
    assert snap["active_items"][0]["conversation_id"] == 1
    assert snap["active_items"][0]["source"] == "user_chat"
    assert snap["active_items"][0]["title"] == "会话甲"

    assert len(snap["queued_items"]) == 1
    assert snap["queued_items"][0]["conversation_id"] == 2
    assert snap["queued_items"][0]["priority"] == 30


def test_resolve_llm_label() -> None:
    from src.llm.registry import LlmModelEntry, LlmProviderEntry, LlmRegistry
    from src.llm.runtime_label import resolve_llm_label

    registry = LlmRegistry(
        active_provider_id="dashscope",
        active_model_id="qwen-max",
        providers=[
            LlmProviderEntry(
                id="dashscope",
                source="builtin",
                display_name="通义",
                base_url="https://example.com",
                models=[LlmModelEntry(id="qwen-max")],
            )
        ],
    )
    assert resolve_llm_label(registry) == "通义 / qwen-max"
    assert resolve_llm_label(LlmRegistry()) == "未配置模型"
