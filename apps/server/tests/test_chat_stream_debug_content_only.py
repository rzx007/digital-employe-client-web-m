import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from src import models  # noqa: F401
from src.db.base import Base
from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.workspace import Workspace
from src.service.chat_service import ChatService


class _FakeAgent:
    async def astream(self, *_args, **_kwargs):
        yield {"content": "你好"}


class ChatStreamDebugContentOnlyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

        workspace = Workspace(id=1, name="默认工作空间", root_path="/tmp")
        employee = Employee(
            id=10,
            workspace_id=1,
            employee_code="test-employee",
            name="测试员工",
            skills_json="[]",
            meta_json="{}",
        )
        conversation = Conversation(
            id=1,
            workspace_id=1,
            target_type="employee",
            target_id=10,
            title="调试会话",
        )
        self.db.add_all([workspace, employee, conversation])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    async def test_stream_returns_only_content_when_debug_content_only_enabled(self) -> None:
        with patch("src.service.chat_service.get_agent", return_value=_FakeAgent()):
            chunks = []
            async for chunk in ChatService.stream_conversation_answer(
                self.db,
                conversation_id=1,
                question="你好",
                skill_name="",
                debug_content_only=True,
            ):
                chunks.append(chunk)

        self.assertEqual(chunks, ["data: 你好\n\n", "data: [DONE]\n\n"])

        assistant_message = self.db.scalar(
            select(ConversationMessage).where(ConversationMessage.role == "assistant")
        )
        self.assertIsNotNone(assistant_message)
        self.assertEqual(assistant_message.content, "你好")

    async def test_stream_keeps_json_chunks_by_default(self) -> None:
        with patch("src.service.chat_service.get_agent", return_value=_FakeAgent()):
            chunks = []
            async for chunk in ChatService.stream_conversation_answer(
                self.db,
                conversation_id=1,
                question="你好",
                skill_name="",
            ):
                chunks.append(chunk)

        self.assertEqual(chunks, ['data: {"content": "你好"}\n\n', "data: [DONE]\n\n"])

    def test_extract_text_from_langchain_serialized_chunk(self) -> None:
        chunk = [
            {
                "lc": 1,
                "type": "constructor",
                "id": ["langchain", "schema", "messages", "AIMessageChunk"],
                "kwargs": {
                    "content": "你好",
                    "response_metadata": {"model_provider": "openai"},
                },
            },
            {"langgraph_node": "model"},
        ]

        text = ChatService._extract_text_from_chunk(chunk)

        self.assertEqual(text, "你好")


if __name__ == "__main__":
    unittest.main()
