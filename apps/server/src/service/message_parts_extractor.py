"""从 stream_chunks JSON 直接提取结构化 parts（单遍遍历）。

取代前端 message-utils.ts 中的 LangChain chunk 解析，让服务端输出可直接
渲染的 UIMessage.parts 数组。前端不再需要 parseLangChainPayloadToChunks、
accumulateChunksToParts 等 streaming 管道。
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def extract_message_parts(stream_chunks_json: str) -> list[dict] | None:
    """从 stream_chunks JSON 提取有序的 parts 列表。

    stream_chunks 格式：[{"seq":N, "data":payload}, ...]
    每个 payload 是 SSE event 的 data 字段，经过 convert_to_serializable 后的 JSON。

    单遍遍历所有 payload，按事件顺序交错输出 text 和 tool parts。
    """
    try:
        events = json.loads(stream_chunks_json)
    except (json.JSONDecodeError, TypeError):
        return None

    if not isinstance(events, list) or len(events) == 0:
        return None

    payloads: list = []
    for evt in events:
        if isinstance(evt, dict) and "data" in evt:
            payloads.append(evt["data"])

    if len(payloads) == 0:
        return None

    return _replay_payloads_to_parts(payloads)


def extract_message_parts_from_buffer(events: list[dict]) -> list[dict] | None:
    """从 StreamEventBuffer 的事件列表直接提取 structured parts。
    
    用于在终态写入 DB 时，从内存 buffer 的事件列表中提取前端可直接渲染的结构化 message_parts
    不经过 JSON 序列化/反序列化，直接处理内存中的 buffer 事件。
    events 格式：[{"seq": N, "data": payload}, ...]
    每个 payload 是 convert_to_serializable 后的 dict。
    """
    if not events:
        return None
    payloads = [e["data"] for e in events if isinstance(e, dict) and "data" in e]
    if not payloads:
        return None
    return _replay_payloads_to_parts(payloads)


def _replay_payloads_to_parts(payloads: list) -> list[dict]:
    parts: list[dict] = []
    text_buf: str = ""
    tool_meta: dict[str, dict] = {}  # toolCallId → {toolCallId, toolName, input, inputText}
    tool_call_index_to_id: dict[int, str] = {}  # array index → toolCallId（用于 tool_call_chunks 的 id 为空时回退）

    def _flush_text() -> None:
        nonlocal text_buf
        if text_buf:
            parts.append({"type": "text", "text": text_buf, "state": "done"})
            text_buf = ""

    def _resolve_tool_id_from_index(tcc: dict) -> str | None:
        """当 tool_call_chunks / invalid_tool_calls 的 id 为空时，通过 index 回退匹配"""
        tcc_index = tcc.get("index")
        if isinstance(tcc_index, int) and tcc_index in tool_call_index_to_id:
            return tool_call_index_to_id[tcc_index]
        return None

    def _ensure_tool_meta(tid: str, name: str) -> dict:
        meta = tool_meta.get(tid)
        if meta is None:
            meta = {
                "toolCallId": tid,
                "toolName": name or "",
                "input": None,
                "inputText": "",
            }
            tool_meta[tid] = meta
        if name and not meta["toolName"]:
            meta["toolName"] = name
        return meta

    for raw in payloads:
        # 错误 payload
        err_msg = _extract_error(raw)
        if err_msg is not None:
            _flush_text()
            parts.append({"type": "text", "text": "\u26a0\ufe0fERROR:" + err_msg, "state": "done"})
            break

        inner = _unwrap_stream_payload(raw)
        if inner is None:
            continue

        # ── AIMessageChunk ──
        msg_chunk = _extract_ai_message_chunk(inner)
        if msg_chunk is not None:
            # 注册/更新 tool_calls 元数据
            for idx, tc in enumerate(msg_chunk.get("toolCalls", [])):
                tid = tc.get("id")
                if not tid:
                    continue
                tool_call_index_to_id[idx] = tid
                meta = _ensure_tool_meta(tid, tc.get("name") or "")
                args = tc.get("args")
                if isinstance(args, dict) and len(args) > 0 and not meta["inputText"]:
                    meta["input"] = args

            # 累积 tool_call_chunks 参数增量（id 为空时通过 index 回退匹配）
            for tcc in msg_chunk.get("toolCallChunks", []):
                tcc_args = tcc.get("args")
                if not isinstance(tcc_args, str):
                    continue
                tid = tcc.get("id")
                if not tid:
                    tid = _resolve_tool_id_from_index(tcc)
                if not tid:
                    continue
                meta = _ensure_tool_meta(tid, tcc.get("name") or "")
                meta["inputText"] += tcc_args

            # invalid_tool_calls 作为 tool_call_chunks 的后备
            if len(msg_chunk.get("toolCallChunks", [])) == 0:
                for itc in msg_chunk.get("invalidToolCalls", []):
                    itc_args = itc.get("args")
                    if not isinstance(itc_args, str):
                        continue
                    tid = itc.get("id")
                    if not tid:
                        tid = _resolve_tool_id_from_index(itc)
                    if not tid:
                        continue
                    meta = _ensure_tool_meta(tid, itc.get("name") or "")
                    if not meta["inputText"]:
                        meta["inputText"] += itc_args

            # 累积文本
            content = msg_chunk.get("content")
            if isinstance(content, str) and content:
                text_buf += content
            continue

        # ── ToolMessage ──
        tool_out = _extract_tool_output(inner)
        if tool_out is not None:
            _flush_text()
            tid = tool_out["toolCallId"]
            meta = tool_meta.get(tid)
            tool_name = tool_out["toolName"] or (meta["toolName"] if meta else "") or "unknown"

            parsed_input = None
            if meta and meta.get("inputText"):
                parsed_input = _try_parse_json(meta["inputText"])
            if parsed_input is None and meta:
                parsed_input = meta.get("input")
            if parsed_input is None:
                parsed_input = None

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

    _flush_text()
    return parts if parts else None


# ── Helper functions ──


def _extract_error(raw) -> str | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("status") == "error" and isinstance(raw.get("error"), str):
        return raw["error"]
    return None


def _unwrap_stream_payload(raw):
    """解包 v2 stream mode: {type:"messages", data:[...]} → data, {type:"updates", ...} → None"""
    if not isinstance(raw, dict):
        return raw
    if raw.get("type") == "messages" and isinstance(raw.get("data"), list):
        return raw["data"]
    if raw.get("type") == "updates":
        return None
    return raw


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

    content = kwargs.get("content")
    content_str = content if isinstance(content, str) and len(content) > 0 else None

    # tool_calls：LangChain constructor 格式 {id, type, kwargs:{id, name, args}},
    # 兼容 __type__ 格式 {id, name, args}
    tool_calls: list[dict] = []
    raw_tcs = kwargs.get("tool_calls")
    if isinstance(raw_tcs, list):
        for tc in raw_tcs:
            if not isinstance(tc, dict):
                continue
            inner = tc.get("kwargs") if isinstance(tc.get("kwargs"), dict) else tc
            tool_calls.append({
                "id": inner.get("id") if isinstance(inner.get("id"), str) and inner.get("id") else None,
                "name": inner.get("name") if isinstance(inner.get("name"), str) and inner.get("name") else None,
                "args": inner.get("args") if inner.get("args") is not None else inner.get("function"),
            })

    # tool_call_chunks（流式增量参数片段，id 在后续 chunk 中可能为空，需 index 回退）
    tool_call_chunks: list[dict] = []
    raw_tccs = kwargs.get("tool_call_chunks")
    if isinstance(raw_tccs, list):
        for tcc in raw_tccs:
            if not isinstance(tcc, dict):
                continue
            inner = tcc.get("kwargs") if isinstance(tcc.get("kwargs"), dict) else tcc
            tool_call_chunks.append({
                "id": inner.get("id") if isinstance(inner.get("id"), str) and inner.get("id") else None,
                "name": inner.get("name") if isinstance(inner.get("name"), str) and inner.get("name") else None,
                "args": inner.get("args") if isinstance(inner.get("args"), str) else None,
                "index": tcc.get("index") if isinstance(tcc.get("index"), int) else None,
            })

    # invalid_tool_calls（解析失败的工具调用，作为工具参数的后备来源）
    invalid_tool_calls: list[dict] = []
    raw_itcs = kwargs.get("invalid_tool_calls")
    if isinstance(raw_itcs, list):
        for itc in raw_itcs:
            if not isinstance(itc, dict):
                continue
            inner = itc.get("kwargs") if isinstance(itc.get("kwargs"), dict) else itc
            invalid_tool_calls.append({
                "id": inner.get("id") if isinstance(inner.get("id"), str) and inner.get("id") else None,
                "name": inner.get("name") if isinstance(inner.get("name"), str) and inner.get("name") else None,
                "args": inner.get("args") if isinstance(inner.get("args"), str) else None,
                "index": itc.get("index") if isinstance(itc.get("index"), int) else None,
            })

    return {
        "content": content_str,
        "toolCalls": tool_calls,
        "toolCallChunks": tool_call_chunks,
        "invalidToolCalls": invalid_tool_calls,
    }


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
