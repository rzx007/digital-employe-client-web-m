"""HITL 中断 message_parts 回归：同一工具调用不应产出重复 part。"""

from __future__ import annotations

from src.service.hitl_pending_parts import extract_message_parts_for_interrupt

TOOL_CALL_ID = "call_4b93e30b9f004042ba781b8f"
EMPLOYEE_IDS = "[25, 26, 27, 28, 29]"

# 批量解聘被 HITL 中断：buffer 里只有 AIMessage(tool_calls)，没有 ToolMessage。
INTERRUPT_BUFFER_EVENTS = [
    {
        "seq": 0,
        "data": {
            "type": "updates",
            "data": {
                "model": {
                    "messages": [
                        {
                            "lc": 1,
                            "type": "constructor",
                            "id": ["langchain", "schema", "messages", "AIMessage"],
                            "kwargs": {
                                "content": "好的，我来批量解聘。",
                                "type": "ai",
                                "id": "lc_run--batch-dismiss-test",
                                "tool_calls": [
                                    {
                                        "name": "delete_employees_batch",
                                        "args": {"employee_ids": EMPLOYEE_IDS},
                                        "id": TOOL_CALL_ID,
                                        "type": "tool_call",
                                    }
                                ],
                            },
                        }
                    ]
                }
            },
        },
    },
]

INTERRUPT_PAYLOAD = {
    "action_requests": [
        {
            "name": "delete_employees_batch",
            "args": {"employee_ids": EMPLOYEE_IDS},
            "description": "Tool execution requires approval",
        }
    ],
    "review_configs": [
        {
            "action_name": "delete_employees_batch",
            "allowed_decisions": ["approve", "reject"],
        }
    ],
}


def test_interrupt_batch_dismiss_emits_single_pending_part() -> None:
    parts = extract_message_parts_for_interrupt(
        INTERRUPT_BUFFER_EVENTS,
        INTERRUPT_PAYLOAD,
        stream_msg_id=1859,
    )

    tool_parts = [
        p for p in parts if p.get("type") == "tool-delete_employees_batch"
    ]

    # 中断兜底的 output-available 占位 part 不应与重新追加的 input-available
    # 待确认 part 同时存在，否则前端会渲染两张卡。
    assert len(tool_parts) == 1, tool_parts
    assert tool_parts[0]["state"] == "input-available"
    assert tool_parts[0]["toolCallId"] == TOOL_CALL_ID
