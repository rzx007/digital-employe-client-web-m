"""Integration: read_file dedupe runs in OpenAICompatibleFilesystemMiddleware.wrap_model_call."""

from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest
from langchain_core.messages import AIMessage, ToolMessage

from src.service.agent.compatible_filesystem_middleware import (
    OpenAICompatibleFilesystemMiddleware,
)
from src.service.agent.read_file_dedupe import read_file_dedupe_placeholder


def test_wrap_model_call_dedupes_before_handler() -> None:
    path = "/artifacts/demo.md"
    messages = [
        AIMessage(
            content="",
            tool_calls=[
                {"id": "c1", "name": "read_file", "args": {"file_path": path}},
            ],
        ),
        ToolMessage(content="FIRST " * 200, name="read_file", tool_call_id="c1"),
        AIMessage(
            content="",
            tool_calls=[
                {"id": "c2", "name": "read_file", "args": {"file_path": path}},
            ],
        ),
        ToolMessage(content="SECOND", name="read_file", tool_call_id="c2"),
    ]
    captured: list[ModelRequest] = []

    def handler(request: ModelRequest) -> MagicMock:
        captured.append(request)
        return MagicMock()

    mw = OpenAICompatibleFilesystemMiddleware()
    mw.wrap_model_call(ModelRequest(messages=messages, model=MagicMock()), handler)

    assert captured, "handler should be invoked"
    out_msgs = captured[0].messages
    assert read_file_dedupe_placeholder(path) in str(out_msgs[1].content)
    assert out_msgs[3].content == "SECOND"
