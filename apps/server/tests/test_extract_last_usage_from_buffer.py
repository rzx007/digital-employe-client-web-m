"""Tests for _extract_peak_usage_from_buffer.

Regression 1: real v2 messages-mode events store the message double-nested at
data[0][0] with usage_metadata under its kwargs (LC constructor format). The
extractor previously only looked at data[0], landing on the [msg, meta] list,
failing isinstance(dict), and returning None — so every turn fell through to
the local estimate even when the model API returned real usage.

Regression 2: a turn with tool calls makes MULTIPLE LLM calls; the last call's
input_tokens can be SMALLER than an earlier peak (context grows as tool results
accumulate, then a final short call may run on a trimmed context). The ring must
reflect the PEAK input_tokens of the turn, not the last call. Subagent calls
(non-empty ns) run on their own small contexts and must be excluded from the
parent turn's context size.
"""

from src.service.stream_registry import _extract_peak_usage_from_buffer

_USAGE = {
    "input_tokens": 12,
    "output_tokens": 474,
    "total_tokens": 486,
    "input_token_details": {"cache_read": 0},
    "output_token_details": {},
}


def _messages_event(usage, ns=None):
    """Build a buffered event mirroring the real serialized v2 messages shape.

    {"type":"messages","ns":[...],"data":[[<LC-serialized AIMessageChunk>, <meta>]]}
    where usage lives at data[0][0]["kwargs"]["usage_metadata"]. ns non-empty
    marks a subagent (task subgraph) chunk.
    """
    msg = {
        "lc": 1,
        "type": "constructor",
        "id": ["langchain", "schema", "messages", "AIMessageChunk"],
        "kwargs": {
            "content": "",
            "type": "AIMessageChunk",
            "usage_metadata": usage,
            "tool_calls": [],
            "invalid_tool_calls": [],
        },
    }
    return {
        "seq": 1,
        "data": {"type": "messages", "ns": ns or [], "data": [[msg, {"langgraph_node": "model"}]]},
    }


def test_extracts_usage_from_real_v2_messages_envelope() -> None:
    buffer = [_messages_event(_USAGE)]
    assert _extract_peak_usage_from_buffer(buffer) == _USAGE


def test_returns_peak_input_not_last() -> None:
    """Last call (input=5000) is smaller than an earlier peak (input=42000)."""
    peak = dict(_USAGE, input_tokens=42000, output_tokens=120)
    last = dict(_USAGE, input_tokens=5000, output_tokens=8)
    buffer = [_messages_event(peak), _messages_event(last)]
    result = _extract_peak_usage_from_buffer(buffer)
    assert result["input_tokens"] == 42000


def test_ignores_subagent_usage() -> None:
    """A subagent (non-empty ns) chunk with huge input must not be picked."""
    parent = dict(_USAGE, input_tokens=8000)
    subagent = dict(_USAGE, input_tokens=99000)
    buffer = [
        _messages_event(parent),
        _messages_event(subagent, ns=["tools:abc-123"]),
    ]
    result = _extract_peak_usage_from_buffer(buffer)
    assert result["input_tokens"] == 8000


def test_returns_none_when_no_usage_present() -> None:
    no_usage = {
        "seq": 1,
        "data": {
            "type": "messages",
            "ns": [],
            "data": [
                [
                    {
                        "lc": 1,
                        "type": "constructor",
                        "id": ["langchain", "schema", "messages", "AIMessageChunk"],
                        "kwargs": {"content": "hi", "type": "AIMessageChunk"},
                    },
                    {"langgraph_node": "model"},
                ]
            ],
        },
    }
    assert _extract_peak_usage_from_buffer([no_usage]) is None
