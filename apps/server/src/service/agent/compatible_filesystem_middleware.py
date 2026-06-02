"""DashScope / OpenAI 兼容模式：read_file 按 encoding 区分文本与多模态。"""

import base64
import binascii
import logging
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, cast

from src.llm.vision import active_model_supports_vision
from src.service.basic_file_reader import (
    estimate_base64_decoded_bytes,
    format_multimodal_size_error,
    is_multimodal_payload_too_large,
)
from src.service.image_multimodal import (
    LLM_IMAGE_MAX_VISUAL_TOKENS,
    prepare_image_bytes_for_llm,
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

_UNSUPPORTED_OPENAI_BLOCK_TYPES = frozenset({"file", "audio"})


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


def _message_needs_sanitize(
    message: BaseMessage, *,
    allow_images: bool
) -> bool:
    for block in message.content_blocks:
        block_type = _block_type(block)
        if block_type in _UNSUPPORTED_OPENAI_BLOCK_TYPES:
            return True
        if block_type == "image":
            return True
        if block_type == "image_url" and not allow_images:
            return True
    return False


def _normalize_image_block_for_api(
    block: ContentBlock | dict[str, Any],
) -> ContentBlock:
    """LangChain OpenAI 兼容 API 更稳的 image_url data URI 格式。"""
    base64_data = str(block.get("base64") or block.get("data") or "")
    mime_type = str(block.get("mime_type") or "application/octet-stream")
    return cast(
        "ContentBlock",
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{base64_data}"},
        },
    )


def _sanitize_message_for_openai_compatible(
    message: BaseMessage,
    *,
    allow_images: bool,
) -> BaseMessage:
    """将 checkpoint 中不兼容的内容块转为文本，避免 DashScope 400。

    该函数用于清理消息中的内容块，将其转换为 OpenAI 兼容格式。主要处理以下场景：
    - 文件类型内容块转换为提示文本
    - 图片类型内容块根据模型能力进行标准化或转换
    - 音频类型内容块转换为不支持提示
    - 超大图片检测并生成错误提示

    Args:
        message: 需要清理的原始消息对象，包含多个内容块
        allow_images: 是否允许图片内容传递给模型，用于控制图片内容的处理方式

    Returns:
        清理后的消息对象，所有不兼容的内容块已转换为文本格式或标准化格式
    """
    # 如果消息不需要清理，直接返回原消息
    if not _message_needs_sanitize(message, allow_images=allow_images):
        return message

    new_blocks: list[ContentBlock] = []
    for block in message.content_blocks:
        block_type = _block_type(block)

        # 处理文件类型内容块：转换为无法发送的提示文本
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
        # 处理图片类型内容块：根据大小和模型能力决定处理方式
        elif block_type == "image":
            path = ""
            if isinstance(message, ToolMessage):
                path = str(message.additional_kwargs.get("read_file_path") or "")

            # 检查图片是否超过大小限制
            if is_multimodal_payload_too_large(
                base64_data=str(block.get("base64") or block.get("data") or "")
            ):
                size_bytes = _image_block_byte_size(block)
                new_blocks.append(
                    _oversized_image_message(path or "image", size_bytes)
                )
            # 如果模型支持图片且未超限，标准化图片格式
            elif allow_images:
                new_blocks.append(_normalize_image_block_for_api(block))
            # 模型不支持图片时，转换为提示文本
            else:
                new_blocks.append(
                    cast(
                        "ContentBlock",
                        {
                            "type": "text",
                            "text": (
                                f"[当前模型不支持图片理解"
                                f"{' (' + path + ')' if path else ''}；"
                                f"请在设置中切换到视觉模型（如 qwen-vl-max）后重试]"
                            ),
                        },
                    )
                )
        # 处理图片 URL 类型：仅在允许图片时保留
        elif block_type == "image_url" and allow_images:
            new_blocks.append(block)
        # 处理音频类型内容块：转换为不支持提示
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
        # 其他类型内容块保持不变
        else:
            new_blocks.append(block)

    # 优化：如果只有一个文本块，直接使用字符串内容而非列表
    if len(new_blocks) == 1 and _block_type(new_blocks[0]) == "text":
        text = str(new_blocks[0].get("text") or "")
        return message.model_copy(update={"content": text})

    return message.model_copy(update={"content": new_blocks})


def sanitize_messages_for_openai_compatible(
    messages: list[BaseMessage],
    *,
    allow_images: bool | None = None,
) -> list[BaseMessage]:
    if allow_images is None:
        allow_images = active_model_supports_vision()
    sanitized = [
        _sanitize_message_for_openai_compatible(m, allow_images=allow_images)
        for m in messages
    ]
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
        try:
            raw = base64.b64decode(content, validate=True)
            image = prepare_image_bytes_for_llm(
                raw,
                source_name=validated_path,
                max_visual_tokens=LLM_IMAGE_MAX_VISUAL_TOKENS,
            )
        except (binascii.Error, ValueError) as exc:
            if is_multimodal_payload_too_large(base64_data=content):
                size_bytes = estimate_base64_decoded_bytes(content)
                error_content = format_multimodal_size_error(
                    validated_path,
                    size_bytes,
                )
            else:
                error_content = str(exc)
            return ToolMessage(
                content=error_content,
                name="read_file",
                tool_call_id=tool_call_id,
                status="error",
            )
        return ToolMessage(
            content_blocks=cast(
                "list[ContentBlock]",
                [
                    {
                        "type": "image",
                        "base64": image.base64_data,
                        "mime_type": image.mime_type,
                    }
                ],
            ),
            name="read_file",
            tool_call_id=tool_call_id,
            additional_kwargs={
                "read_file_path": validated_path,
                "read_file_media_type": image.mime_type,
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
        allow_images = active_model_supports_vision()
        messages = sanitize_messages_for_openai_compatible(
            list(request.messages),
            allow_images=allow_images,
        )
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
        allow_images = active_model_supports_vision()
        messages = sanitize_messages_for_openai_compatible(
            list(request.messages),
            allow_images=allow_images,
        )
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
