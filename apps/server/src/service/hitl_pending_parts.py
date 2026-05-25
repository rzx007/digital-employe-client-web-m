"""Build pending HITL tool parts for interrupt flush (message_parts)."""

from __future__ import annotations

import copy
from typing import Any

from src.service.message_parts_extractor import extract_message_parts_from_buffer

HITL_TOOL_NAMES = frozenset(
    {"submit_clarifying_questions", "submit_document_plan"}
)


def _is_hitl_tool_name(name: str) -> bool:
    return name in HITL_TOOL_NAMES


def _extract_tool_call_id_from_buffer(events: list[dict]) -> str | None:
    """Scan buffer updates for the last AIMessage tool_calls id."""
    for evt in reversed(events):
        if not isinstance(evt, dict):
            continue
        data = evt.get("data")
        if not isinstance(data, dict) or data.get("type") != "updates":
            continue
        payload = data.get("data")
        if not isinstance(payload, dict):
            continue
        model = payload.get("model")
        if not isinstance(model, dict):
            continue
        messages = model.get("messages")
        if not isinstance(messages, list):
            continue
        for message in reversed(messages):
            if not isinstance(message, dict):
                continue
            kwargs = message.get("kwargs")
            if not isinstance(kwargs, dict):
                continue
            tool_calls = kwargs.get("tool_calls")
            if not isinstance(tool_calls, list):
                continue
            for tc in reversed(tool_calls):
                if not isinstance(tc, dict):
                    continue
                tid = tc.get("id")
                name = tc.get("name")
                if (
                    isinstance(tid, str)
                    and tid
                    and isinstance(name, str)
                    and _is_hitl_tool_name(name)
                ):
                    return tid
    return None


def _part_is_pending_hitl(part: dict) -> bool:
    ptype = part.get("type")
    if not isinstance(ptype, str) or not ptype.startswith("tool-"):
        return False
    tool_name = ptype.removeprefix("tool-")
    if not _is_hitl_tool_name(tool_name):
        return False
    state = part.get("state")
    if state in ("output-available", "output-error"):
        return False
    if part.get("output"):
        return False
    return True


def build_pending_hitl_parts(
    action_requests: list[dict],
    tool_call_id: str | None,
    stream_msg_id: int,
) -> list[dict]:
    parts: list[dict] = []
    fallback_idx = 0
    for action in action_requests:
        if not isinstance(action, dict):
            continue
        name = action.get("name")
        if not isinstance(name, str) or not _is_hitl_tool_name(name):
            continue
        args = action.get("args")
        if not isinstance(args, dict):
            args = {}
        tid = tool_call_id
        if not tid:
            tid = f"hitl-{stream_msg_id}-{fallback_idx}"
            fallback_idx += 1
        parts.append(
            {
                "type": f"tool-{name}",
                "toolCallId": tid,
                "state": "input-available",
                "input": copy.deepcopy(args),
            }
        )
    return parts


def extract_message_parts_for_interrupt(
    buffer_events: list[dict],
    interrupt_payload: dict,
    stream_msg_id: int,
) -> list[dict]:
    base = extract_message_parts_from_buffer(buffer_events) or []
    filtered = [p for p in base if not _part_is_pending_hitl(p)]

    action_requests = interrupt_payload.get("action_requests")
    if not isinstance(action_requests, list):
        return filtered if filtered else base

    tool_call_id = _extract_tool_call_id_from_buffer(buffer_events)
    pending = build_pending_hitl_parts(action_requests, tool_call_id, stream_msg_id)
    if not pending:
        return filtered if filtered else base

    return [*filtered, *pending]
