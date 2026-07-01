"""从 stream_chunks JSON 直接提取结构化 parts（单遍遍历）。

取代前端 message-utils.ts 中的 LangChain chunk 解析，让服务端输出可直接
渲染的 UIMessage.parts 数组。前端不再需要 parseLangChainPayloadToChunks、
accumulateChunksToParts 等 streaming 管道。
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

# 中断（interrupted）时给未收到 ToolMessage 的工具合成的占位结果哨兵。
# 它并非真实工具输出，HITL 待确认流程据此识别并替换该占位 part。
INTERRUPT_PAUSE_SENTINEL = "[已暂停，等待继续]"


def extract_message_parts_from_buffer(
    events: list[dict],
    *,
    terminal_state: str | None = None,
) -> list[dict] | None:
    """从 StreamEventBuffer 的事件列表直接提取 structured parts。

    用于在终态写入 DB 时，从内存 buffer 的事件列表中提取前端可直接渲染的结构化 message_parts
    不经过 JSON 序列化/反序列化，直接处理内存中的 buffer 事件。
    events 格式：[{"seq": N, "data": payload}, ...]
    每个 payload 是 convert_to_serializable 后的 dict。

    terminal_state 为 cancelled/error/interrupted 时，会把尚未收到 ToolMessage
    的工具调用（如 shell_execute 执行中）也落库，避免中断后记录消失。
    """
    if not events:
        return None
    payloads = [e["data"] for e in events if isinstance(e, dict) and "data" in e]
    if not payloads:
        return None
    return _replay_payloads_to_parts(payloads, terminal_state=terminal_state)


def _langgraph_node_from_inner(inner) -> str | None:
    """从 messages 事件的 data 元组读取 langgraph_node。"""
    if not isinstance(inner, list) or len(inner) < 2:
        return None
    meta = inner[1]
    if not isinstance(meta, dict):
        return None
    node = meta.get("langgraph_node")
    return node if isinstance(node, str) else None


def _lc_source_from_inner(inner) -> str | None:
    """从 messages 元组读取 lc_source（如 summarization）。"""
    if not isinstance(inner, list) or len(inner) < 2:
        return None
    meta = inner[1]
    if not isinstance(meta, dict):
        return None
    src = meta.get("lc_source")
    return src if isinstance(src, str) else None


class _ToolReplayState:
    """跨 payload 累积工具 input，与前端 LangChainStreamParseState 对齐。"""

    def __init__(self) -> None:
        self.tool_meta: dict[str, dict] = {}
        # 全局 index → toolCallId（向后兼容）
        self.tool_call_index_to_id: dict[int, str] = {}
        # lc_run id 作用域：index → toolCallId / 主工具 id
        self.chunk_index_to_id: dict[str, dict[int, str]] = {}
        self.primary_tool_call_id_by_chunk: dict[str, str] = {}

    def ensure_tool_meta(self, tid: str, name: str) -> dict:
        meta = self.tool_meta.get(tid)
        if meta is None:
            meta = {
                "toolCallId": tid,
                "toolName": name or "",
                "input": None,
                "inputText": "",
            }
            self.tool_meta[tid] = meta
        if name and not meta["toolName"]:
            meta["toolName"] = name
        return meta

    def register_tool_call(
        self,
        tid: str,
        name: str,
        args: object,
        *,
        chunk_id: str,
        array_index: int,
    ) -> None:
        if chunk_id:
            self.chunk_index_to_id.setdefault(chunk_id, {})[array_index] = tid
            if name:
                self.primary_tool_call_id_by_chunk[chunk_id] = tid
        self.tool_call_index_to_id[array_index] = tid
        meta = self.ensure_tool_meta(tid, name)
        if isinstance(args, dict) and len(args) > 0:
            meta["input"] = args

    def resolve_tool_id(self, chunk_id: str, entry: dict) -> str | None:
        tid = entry.get("id")
        if isinstance(tid, str) and tid:
            return tid

        index = entry.get("index")
        if isinstance(index, int):
            if chunk_id:
                scoped = self.chunk_index_to_id.get(chunk_id, {})
                if index in scoped:
                    return scoped[index]
            if index in self.tool_call_index_to_id:
                return self.tool_call_index_to_id[index]

        if chunk_id:
            primary = self.primary_tool_call_id_by_chunk.get(chunk_id)
            if primary:
                return primary
        return None

    def append_input_delta(
        self,
        chunk_id: str,
        entry: dict,
        delta: str,
    ) -> None:
        if not delta:
            return
        tid = self.resolve_tool_id(chunk_id, entry)
        if not tid:
            return
        name = entry.get("name")
        name_str = name if isinstance(name, str) else ""
        meta = self.ensure_tool_meta(tid, name_str)
        meta["inputText"] += delta

    def apply_tool_payload(
        self,
        payload: dict,
        *,
        chunk_id: str = "",
    ) -> None:
        tool_calls = payload.get("toolCalls") or []
        tool_call_chunks = payload.get("toolCallChunks") or []
        invalid_tool_calls = payload.get("invalidToolCalls") or []

        for idx, tc in enumerate(tool_calls):
            tid = tc.get("id")
            if not tid:
                continue
            self.register_tool_call(
                tid,
                tc.get("name") or "",
                tc.get("args"),
                chunk_id=chunk_id,
                array_index=idx,
            )

        string_deltas = [
            tcc
            for tcc in tool_call_chunks
            if isinstance(tcc.get("args"), str) and tcc["args"]
        ]
        fallback_deltas = (
            []
            if string_deltas
            else [
                itc
                for itc in invalid_tool_calls
                if isinstance(itc.get("args"), str) and itc["args"]
            ]
        )

        for fallback_index, entry in enumerate([*string_deltas, *fallback_deltas]):
            if entry.get("index") is None and isinstance(fallback_index, int):
                entry = {**entry, "index": fallback_index}
            delta = entry.get("args")
            if not isinstance(delta, str) or not delta:
                continue
            self.append_input_delta(chunk_id, entry, delta)


def _resolve_tool_input(meta: dict | None) -> object | None:
    if not meta:
        return None
    stored = meta.get("input")
    if isinstance(stored, dict) and len(stored) > 0:
        return stored
    input_text = meta.get("inputText")
    if isinstance(input_text, str) and input_text.strip():
        parsed = _try_parse_json(input_text)
        if parsed is not None:
            return parsed
    if stored is not None:
        return stored
    return None


def _build_tool_part(
    *,
    tool_name: str,
    tool_call_id: str,
    parsed_input: object | None,
    input_text: str,
    result_text: str,
    is_error: bool,
) -> dict:
    tool_part: dict = {
        "type": f"tool-{tool_name}",
        "toolCallId": tool_call_id,
        "state": "output-error" if is_error else "output-available",
        "input": parsed_input,
    }
    if is_error:
        tool_part["errorText"] = result_text or f"{tool_name} 执行失败"
    tool_part["output"] = {
        "status": "error" if is_error else "success",
        "text": result_text,
        "toolName": tool_name,
        "input": parsed_input,
        "inputText": input_text,
    }
    return tool_part


def _append_pending_tool_parts(
    parts: list[dict],
    tool_state: _ToolReplayState,
    tool_streaming_output: dict[str, str],
    tool_streaming_name: dict[str, str],
    emitted_tool_ids: set[str],
    *,
    terminal_state: str | None,
) -> None:
    if terminal_state not in {"cancelled", "error", "interrupted"}:
        return

    for tid, meta in tool_state.tool_meta.items():
        if tid in emitted_tool_ids:
            continue
        tool_name = tool_streaming_name.get(tid) or meta.get("toolName") or "unknown"
        parsed_input = _resolve_tool_input(meta)
        input_text = meta.get("inputText", "") if meta else ""
        stream_text = tool_streaming_output.get(tid, "").strip()

        if terminal_state == "interrupted":
            suffix = INTERRUPT_PAUSE_SENTINEL
            result_text = (
                f"{stream_text}\n\n{suffix}" if stream_text else suffix
            )
            parts.append(
                _build_tool_part(
                    tool_name=tool_name,
                    tool_call_id=tid,
                    parsed_input=parsed_input,
                    input_text=input_text,
                    result_text=result_text,
                    is_error=False,
                )
            )
            continue

        suffix = "[用户已中断]" if terminal_state == "cancelled" else "[执行出错]"
        result_text = f"{stream_text}\n\n{suffix}" if stream_text else suffix
        parts.append(
            _build_tool_part(
                tool_name=tool_name,
                tool_call_id=tid,
                parsed_input=parsed_input,
                input_text=input_text,
                result_text=result_text,
                is_error=True,
            )
        )


def _replay_payloads_to_parts(
    payloads: list,
    *,
    terminal_state: str | None = None,
) -> list[dict]:
    parts: list[dict] = []
    text_buf: str = ""
    text_stream_tag: str | None = None
    tool_state = _ToolReplayState()
    tool_streaming_output: dict[str, str] = {}
    tool_streaming_name: dict[str, str] = {}
    emitted_tool_ids: set[str] = set()

    def _flush_text() -> None:
        nonlocal text_buf, text_stream_tag
        if text_buf:
            p: dict = {"type": "text", "text": text_buf, "state": "done"}
            if text_stream_tag == "summarization":
                p["providerMetadata"] = {
                    "langchain": {"lcSource": "summarization"},
                }
            parts.append(p)
            text_buf = ""
            text_stream_tag = None

    for raw in payloads:
        err_msg = _extract_error(raw)
        if err_msg is not None:
            _flush_text()
            parts.append({"type": "text", "text": "\u26a0\ufe0fERROR:" + err_msg, "state": "done"})
            break

        if isinstance(raw, dict) and raw.get("type") == "updates":
            _apply_updates_tool_meta(raw, tool_state)
            continue

        if isinstance(raw, dict) and raw.get("type") == "tool_output":
            tid = raw.get("tool_call_id")
            chunk = raw.get("chunk")
            tname = raw.get("tool_name")
            if isinstance(tid, str) and tid and isinstance(chunk, str) and chunk:
                prev = tool_streaming_output.get(tid, "")
                tool_streaming_output[tid] = (
                    f"{prev}\n{chunk}" if prev else chunk
                )
            if isinstance(tid, str) and tid and isinstance(tname, str) and tname:
                tool_streaming_name[tid] = tname
            continue

        inner = _unwrap_stream_payload(raw)
        if inner is None:
            continue

        msg_chunk = _extract_ai_message_chunk(inner)
        if msg_chunk is not None:
            chunk_id = msg_chunk.get("messageChunkId") or ""
            tool_state.apply_tool_payload(msg_chunk, chunk_id=chunk_id)

            content = msg_chunk.get("content")
            if isinstance(content, str) and content:
                node = _langgraph_node_from_inner(inner)
                if node is None or node == "model":
                    lc_src = _lc_source_from_inner(inner)
                    tag = "summarization" if lc_src == "summarization" else "default"
                    if (
                        text_buf
                        and text_stream_tag is not None
                        and text_stream_tag != tag
                    ):
                        _flush_text()
                    text_buf += content
                    text_stream_tag = tag
            continue

        tool_out = _extract_tool_output(inner)
        if tool_out is not None:
            _flush_text()
            tid = tool_out["toolCallId"]
            meta = tool_state.tool_meta.get(tid)
            tool_name = tool_out["toolName"] or (meta["toolName"] if meta else "") or "unknown"
            parsed_input = _resolve_tool_input(meta)

            tool_part: dict = {
                "type": f"tool-{tool_name}",
                "toolCallId": tid,
                "state": "output-error" if tool_out["isError"] else "output-available",
                "input": parsed_input,
            }
            if tool_out["isError"]:
                tool_part["errorText"] = tool_out["errorText"]

            tool_part["output"] = {
                "status": "error" if tool_out["isError"] else "success",
                "text": tool_out["resultText"],
                "toolName": tool_name,
                "input": parsed_input,
                "inputText": meta.get("inputText", "") if meta else "",
            }

            parts.append(tool_part)
            emitted_tool_ids.add(tid)

    _flush_text()
    _append_pending_tool_parts(
        parts,
        tool_state,
        tool_streaming_output,
        tool_streaming_name,
        emitted_tool_ids,
        terminal_state=terminal_state,
    )
    return parts if parts else None


def _apply_updates_tool_meta(raw: dict, tool_state: _ToolReplayState) -> None:
    """从 LangGraph updates 事件合并完整 tool_calls（与前端 parseUpdatesPayloadToChunks 对齐）。"""
    data = raw.get("data")
    if not isinstance(data, dict):
        return

    for node_update in data.values():
        if not isinstance(node_update, dict):
            continue
        messages = node_update.get("messages")
        if not isinstance(messages, list):
            continue

        for msg in messages:
            payload = _extract_ai_tool_payload_from_lc_message(msg)
            if payload is None:
                continue
            chunk_id = payload.get("messageChunkId") or ""
            tool_state.apply_tool_payload(payload, chunk_id=chunk_id)


# ── Helper functions ──


def _extract_error(raw) -> str | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("status") == "error" and isinstance(raw.get("error"), str):
        return raw["error"]
    return None


def _unwrap_stream_payload(raw):
    """解包 v2 stream mode: {type:"messages", data:[...]} → data"""
    if not isinstance(raw, dict):
        return raw
    if raw.get("type") == "messages" and isinstance(raw.get("data"), list):
        return raw["data"]
    return raw


def _message_chunk_id_from_kwargs(kwargs: dict) -> str:
    mid = kwargs.get("id")
    return mid if isinstance(mid, str) and mid else ""


def _parse_tool_calls_from_kwargs(kwargs: dict) -> list[dict]:
    tool_calls: list[dict] = []
    raw_tcs = kwargs.get("tool_calls")
    if not isinstance(raw_tcs, list):
        return tool_calls
    for tc in raw_tcs:
        if not isinstance(tc, dict):
            continue
        inner = tc.get("kwargs") if isinstance(tc.get("kwargs"), dict) else tc
        tool_calls.append({
            "id": inner.get("id") if isinstance(inner.get("id"), str) and inner.get("id") else None,
            "name": inner.get("name") if isinstance(inner.get("name"), str) and inner.get("name") else None,
            "args": inner.get("args") if inner.get("args") is not None else inner.get("function"),
        })
    return tool_calls


def _parse_tool_call_chunks_from_kwargs(kwargs: dict, *, use_list_index: bool) -> list[dict]:
    tool_call_chunks: list[dict] = []
    raw_tccs = kwargs.get("tool_call_chunks")
    if not isinstance(raw_tccs, list):
        return tool_call_chunks
    for list_index, tcc in enumerate(raw_tccs):
        if not isinstance(tcc, dict):
            continue
        inner = tcc.get("kwargs") if isinstance(tcc.get("kwargs"), dict) else tcc
        index = tcc.get("index") if isinstance(tcc.get("index"), int) else None
        if index is None and use_list_index:
            index = list_index
        tool_call_chunks.append({
            "id": inner.get("id") if isinstance(inner.get("id"), str) and inner.get("id") else None,
            "name": inner.get("name") if isinstance(inner.get("name"), str) and inner.get("name") else None,
            "args": inner.get("args") if isinstance(inner.get("args"), str) else None,
            "index": index,
        })
    return tool_call_chunks


def _parse_invalid_tool_calls_from_kwargs(kwargs: dict, *, use_list_index: bool) -> list[dict]:
    invalid_tool_calls: list[dict] = []
    raw_itcs = kwargs.get("invalid_tool_calls")
    if not isinstance(raw_itcs, list):
        return invalid_tool_calls
    for list_index, itc in enumerate(raw_itcs):
        if not isinstance(itc, dict):
            continue
        inner = itc.get("kwargs") if isinstance(itc.get("kwargs"), dict) else itc
        index = itc.get("index") if isinstance(itc.get("index"), int) else None
        if index is None and use_list_index:
            index = list_index
        invalid_tool_calls.append({
            "id": inner.get("id") if isinstance(inner.get("id"), str) and inner.get("id") else None,
            "name": inner.get("name") if isinstance(inner.get("name"), str) and inner.get("name") else None,
            "args": inner.get("args") if isinstance(inner.get("args"), str) else None,
            "index": index,
        })
    return invalid_tool_calls


def _build_tool_payload_from_kwargs(kwargs: dict, *, message_chunk_id: str) -> dict:
    content = kwargs.get("content")
    content_str = content if isinstance(content, str) and len(content) > 0 else None
    return {
        "messageChunkId": message_chunk_id,
        "content": content_str,
        "toolCalls": _parse_tool_calls_from_kwargs(kwargs),
        "toolCallChunks": _parse_tool_call_chunks_from_kwargs(kwargs, use_list_index=True),
        "invalidToolCalls": _parse_invalid_tool_calls_from_kwargs(kwargs, use_list_index=True),
    }


def _extract_ai_tool_payload_from_lc_message(msg: dict) -> dict | None:
    """从 LangChain 序列化的 AIMessage / AIMessageChunk 提取工具字段。"""
    if not isinstance(msg, dict):
        return None

    kwargs: dict | None = None
    message_chunk_id = ""

    if msg.get("type") == "constructor" and isinstance(msg.get("id"), list):
        id_str = ".".join(str(x) for x in msg["id"])
        if "AIMessageChunk" in id_str or "AIMessage" in id_str:
            kwargs = msg.get("kwargs") if isinstance(msg.get("kwargs"), dict) else None
    elif isinstance(msg.get("kwargs"), dict):
        kwargs = msg["kwargs"]
    elif msg.get("__type__") in ("AIMessageChunk", "AIMessage"):
        kwargs = msg

    if not isinstance(kwargs, dict):
        return None

    message_chunk_id = _message_chunk_id_from_kwargs(kwargs)
    return _build_tool_payload_from_kwargs(kwargs, message_chunk_id=message_chunk_id)


def _extract_ai_message_chunk(inner) -> dict | None:
    """从 [AIMessageChunk, Metadata] 元组提取结构化数据"""
    if not isinstance(inner, list) or len(inner) == 0:
        return None
    first = inner[0]
    if not isinstance(first, dict):
        return None
    if not isinstance(first.get("id"), list):
        return None
    id_str = ".".join(str(x) for x in first["id"])
    if "AIMessageChunk" not in id_str or first.get("type") != "constructor":
        return None

    kwargs = first.get("kwargs")
    if not isinstance(kwargs, dict):
        return None

    message_chunk_id = _message_chunk_id_from_kwargs(kwargs)
    return _build_tool_payload_from_kwargs(kwargs, message_chunk_id=message_chunk_id)


def _extract_tool_output(inner) -> dict | None:
    """从 [ToolMessage, Metadata] 元组提取结构化数据"""
    if not isinstance(inner, list) or len(inner) == 0:
        return None
    first = inner[0]
    if not isinstance(first, dict):
        return None
    if not isinstance(first.get("id"), list):
        return None
    id_str = ".".join(str(x) for x in first["id"])
    if "ToolMessage" not in id_str or first.get("type") != "constructor":
        return None

    kwargs = first.get("kwargs")
    if not isinstance(kwargs, dict) or kwargs.get("type") != "tool":
        return None

    tool_call_id = kwargs.get("tool_call_id")
    if not isinstance(tool_call_id, str) or not tool_call_id:
        return None

    name = kwargs.get("name")
    name_str = name if isinstance(name, str) else ""
    content = kwargs.get("content")
    content_str = content if isinstance(content, str) else ""
    status = kwargs.get("status")
    status_str = status if isinstance(status, str) else "success"
    is_error = status_str != "success"

    return {
        "toolCallId": tool_call_id,
        "toolName": name_str,
        "resultText": content_str,
        "isError": is_error,
        "errorText": (content_str or f"{name_str} 执行失败") if is_error else None,
    }


def _try_parse_json(text: str):
    """尝试 JSON 解析，失败返回 None"""
    if not text or not text.strip():
        return None
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
