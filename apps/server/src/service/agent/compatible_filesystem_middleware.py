"""DashScope / OpenAI 兼容模式：read_file 按 encoding 区分文本与多模态。"""

import logging
import mimetypes
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated, Any, cast

from src.service.basic_file_reader import (
    estimate_base64_decoded_bytes,
    format_multimodal_size_error,
    is_multimodal_payload_too_large,
)
from deepagents.backends.protocol import ReadResult
from deepagents.backends.utils import (
    _get_file_type,
    check_empty_content,
    format_content_with_line_numbers,
    validate_path,
)
from deepagents.middleware.filesystem import (
    DEFAULT_READ_LIMIT,
    DEFAULT_READ_OFFSET,
    NUM_CHARS_PER_TOKEN,
    READ_FILE_TOOL_DESCRIPTION,
    READ_FILE_TRUNCATION_MSG,
    FilesystemMiddleware,
    FilesystemState,
    ReadFileSchema,
    _check_fs_permission,
)
from langchain.agents.middleware.types import (
    ContextT,
    ModelRequest,
    ModelResponse,
    ResponseT,
)
from langchain.tools import ToolRuntime
from langchain_core.messages import BaseMessage, ToolMessage
from langchain_core.messages.content import ContentBlock
from langchain_core.tools import BaseTool, StructuredTool

logger = logging.getLogger(__name__)

_patched = False

_UNSUPPORTED_OPENAI_BLOCK_TYPES = frozenset({"file", "audio", "image"})


def _block_type(block: ContentBlock | dict[str, Any]) -> str:
    value = block.get("type") if isinstance(block, dict) else None
    return str(value or "")


def _image_block_byte_size(block: ContentBlock | dict[str, Any]) -> int:
    base64_data = block.get("base64") or block.get("data") or ""
    if not isinstance(base64_data, str) or not base64_data:
        return 0
    return estimate_base64_decoded_bytes(base64_data)


def _oversized_image_message(path: str, size_bytes: int) -> ContentBlock:
    return cast(
        "ContentBlock",
        {
            "type": "text",
            "text": format_multimodal_size_error(path, size_bytes).removeprefix(
                "Error: "
            ),
        },
    )


def _message_needs_sanitize(message: BaseMessage) -> bool:
    for block in message.content_blocks:
        if _block_type(block) in _UNSUPPORTED_OPENAI_BLOCK_TYPES:
            return True
    return False


def _sanitize_message_for_openai_compatible(message: BaseMessage) -> BaseMessage:
    """将 checkpoint 中不兼容的内容块转为文本，避免 DashScope 400。"""
    if not _message_needs_sanitize(message):
        return message

    new_blocks: list[ContentBlock] = []
    for block in message.content_blocks:
        block_type = _block_type(block)
        if block_type == "file":
            path = ""
            if isinstance(message, ToolMessage):
                path = str(message.additional_kwargs.get("read_file_path") or "")
            filename = str(block.get("filename") or path or "file")
            new_blocks.append(
                cast(
                    "ContentBlock",
                    {
                        "type": "text",
                        "text": (
                            f"[文件 {filename} 无法以多模态形式发送给当前模型；"
                            f"若需内容请重新 read_file 读取]"
                        ),
                    },
                )
            )
        elif block_type == "image":
            path = ""
            if isinstance(message, ToolMessage):
                path = str(message.additional_kwargs.get("read_file_path") or "")
            if is_multimodal_payload_too_large(
                base64_data=str(block.get("base64") or block.get("data") or "")
            ):
                size_bytes = _image_block_byte_size(block)
                new_blocks.append(
                    _oversized_image_message(path or "image", size_bytes)
                )
            else:
                new_blocks.append(
                    cast(
                        "ContentBlock",
                        {
                            "type": "text",
                            "text": (
                                f"[当前模型 API 不支持图片输入"
                                f"{' (' + path + ')' if path else ''}]"
                            ),
                        },
                    )
                )
        elif block_type == "audio":
            new_blocks.append(
                cast(
                    "ContentBlock",
                    {
                        "type": "text",
                        "text": "[音频内容当前模型 API 不支持]",
                    },
                )
            )
        else:
            new_blocks.append(block)

    if len(new_blocks) == 1 and _block_type(new_blocks[0]) == "text":
        text = str(new_blocks[0].get("text") or "")
        return message.model_copy(update={"content": text})

    return message.model_copy(update={"content": new_blocks})


def sanitize_messages_for_openai_compatible(
    messages: list[BaseMessage],
) -> list[BaseMessage]:
    sanitized = [_sanitize_message_for_openai_compatible(m) for m in messages]
    changed = sum(
        1
        for before, after in zip(messages, sanitized)
        if before.content != after.content
    )
    if changed:
        logger.info(
            "Sanitized %d message(s) with unsupported OpenAI content blocks",
            changed,
        )
    return sanitized


def handle_compatible_read_result(
    read_result: ReadResult | str,
    validated_path: str,
    tool_call_id: str | None,
    offset: int,
    limit: int,
    *,
    truncate,
) -> ToolMessage:
    """utf-8 一律按文本；图片走 image；其余二进制不发 type=file。"""
    if isinstance(read_result, str):
        return ToolMessage(
            content=truncate(read_result, validated_path, limit),
            name="read_file",
            tool_call_id=tool_call_id,
            status="success",
        )

    if read_result.error:
        return ToolMessage(
            content=f"Error: {read_result.error}",
            name="read_file",
            tool_call_id=tool_call_id,
            status="error",
        )

    if read_result.file_data is None:
        return ToolMessage(
            content=f"Error: no data returned for '{validated_path}'",
            name="read_file",
            tool_call_id=tool_call_id,
            status="error",
        )

    encoding = read_result.file_data.get("encoding", "utf-8")
    content = read_result.file_data["content"]
    file_type = _get_file_type(validated_path)

    if encoding == "utf-8" or file_type == "text":
        empty_msg = check_empty_content(content)
        if empty_msg:
            return ToolMessage(
                content=empty_msg,
                name="read_file",
                tool_call_id=tool_call_id,
                status="success",
            )
        formatted = format_content_with_line_numbers(content, start_line=offset + 1)
        return ToolMessage(
            content=truncate(formatted, validated_path, limit),
            name="read_file",
            tool_call_id=tool_call_id,
            status="success",
        )

    if file_type == "image":
        if is_multimodal_payload_too_large(base64_data=content):
            size_bytes = estimate_base64_decoded_bytes(content)
            return ToolMessage(
                content=format_multimodal_size_error(validated_path, size_bytes),
                name="read_file",
                tool_call_id=tool_call_id,
                status="error",
            )
        mime_type = mimetypes.guess_type("file" + Path(validated_path).suffix)[0]
        mime_type = mime_type or "application/octet-stream"
        return ToolMessage(
            content_blocks=cast(
                "list[ContentBlock]",
                [{"type": "image", "base64": content, "mime_type": mime_type}],
            ),
            name="read_file",
            tool_call_id=tool_call_id,
            additional_kwargs={
                "read_file_path": validated_path,
                "read_file_media_type": mime_type,
            },
            status="success",
        )

    return ToolMessage(
        content=(
            f"Error: 当前模型 API 不支持以多模态方式读取 {validated_path} "
            f"(type={file_type})。请上传 .docx/.xlsx 等可提取文本的格式，"
            f"或确认文件已通过文本提取后端处理。"
        ),
        name="read_file",
        tool_call_id=tool_call_id,
        status="error",
    )


class OpenAICompatibleFilesystemMiddleware(FilesystemMiddleware):
    """read_file 结果与 DashScope 兼容：禁止向模型发送 type=file 内容块。"""

    def wrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler: Callable[[ModelRequest[ContextT]], ModelResponse[ResponseT]],
    ) -> ModelResponse[ResponseT]:
        messages = sanitize_messages_for_openai_compatible(list(request.messages))
        if messages != list(request.messages):
            request = request.override(messages=messages)
        return super().wrap_model_call(request, handler)

    async def awrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler: Callable[
            [ModelRequest[ContextT]], Awaitable[ModelResponse[ResponseT]]
        ],
    ) -> ModelResponse[ResponseT]:
        messages = sanitize_messages_for_openai_compatible(list(request.messages))
        if messages != list(request.messages):
            request = request.override(messages=messages)
        return await super().awrap_model_call(request, handler)

    def _create_read_file_tool(self) -> BaseTool:
        tool_description = (
            self._custom_tool_descriptions.get("read_file")
            or READ_FILE_TOOL_DESCRIPTION
        )
        token_limit = self._tool_token_limit_before_evict

        def _truncate(content: str, file_path: str, limit: int) -> str:
            lines = content.splitlines(keepends=True)
            if len(lines) > limit:
                lines = lines[:limit]
                content = "".join(lines)

            if token_limit and len(content) >= NUM_CHARS_PER_TOKEN * token_limit:
                truncation_msg = READ_FILE_TRUNCATION_MSG.format(file_path=file_path)
                max_content_length = (
                    NUM_CHARS_PER_TOKEN * token_limit - len(truncation_msg)
                )
                content = content[:max_content_length] + truncation_msg

            return content

        def sync_read_file(
            file_path: Annotated[
                str, "Absolute path to the file to read. Must be absolute, not relative."
            ],
            runtime: ToolRuntime[None, FilesystemState],
            offset: Annotated[
                int,
                "Line number to start reading from (0-indexed). Use for pagination of large files.",
            ] = DEFAULT_READ_OFFSET,
            limit: Annotated[
                int,
                "Maximum number of lines to read. Use for pagination of large files.",
            ] = DEFAULT_READ_LIMIT,
        ) -> ToolMessage:
            """Synchronous wrapper for read_file tool."""
            resolved_backend = self._get_backend(runtime)
            try:
                validated_path = validate_path(file_path)
            except ValueError as exc:
                return ToolMessage(
                    content=f"Error: {exc}",
                    name="read_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            if _check_fs_permission(self._permissions, "read", validated_path) == "deny":
                return ToolMessage(
                    content=f"Error: permission denied for read on {validated_path}",
                    name="read_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            read_result = resolved_backend.read(
                validated_path, offset=offset, limit=limit
            )
            return handle_compatible_read_result(
                read_result,
                validated_path,
                runtime.tool_call_id,
                offset,
                limit,
                truncate=_truncate,
            )

        async def async_read_file(
            file_path: Annotated[
                str, "Absolute path to the file to read. Must be absolute, not relative."
            ],
            runtime: ToolRuntime[None, FilesystemState],
            offset: Annotated[
                int,
                "Line number to start reading from (0-indexed). Use for pagination of large files.",
            ] = DEFAULT_READ_OFFSET,
            limit: Annotated[
                int,
                "Maximum number of lines to read. Use for pagination of large files.",
            ] = DEFAULT_READ_LIMIT,
        ) -> ToolMessage:
            """Asynchronous wrapper for read_file tool."""
            resolved_backend = self._get_backend(runtime)
            try:
                validated_path = validate_path(file_path)
            except ValueError as exc:
                return ToolMessage(
                    content=f"Error: {exc}",
                    name="read_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            if _check_fs_permission(self._permissions, "read", validated_path) == "deny":
                return ToolMessage(
                    content=f"Error: permission denied for read on {validated_path}",
                    name="read_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            read_result = await resolved_backend.aread(
                validated_path, offset=offset, limit=limit
            )
            return handle_compatible_read_result(
                read_result,
                validated_path,
                runtime.tool_call_id,
                offset,
                limit,
                truncate=_truncate,
            )

        return StructuredTool.from_function(
            name="read_file",
            description=tool_description,
            func=sync_read_file,
            coroutine=async_read_file,
            infer_schema=False,
            args_schema=ReadFileSchema,
        )


def install_compatible_filesystem_middleware() -> None:
    global _patched
    if _patched:
        return
    import deepagents.graph as graph_module
    import deepagents.middleware.filesystem as fs_module

    fs_module.FilesystemMiddleware = OpenAICompatibleFilesystemMiddleware
    graph_module.FilesystemMiddleware = OpenAICompatibleFilesystemMiddleware
    _patched = True
    logger.info("Installed OpenAICompatibleFilesystemMiddleware for DashScope")
