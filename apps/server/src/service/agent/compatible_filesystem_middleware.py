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
from deepagents.backends.protocol import EditResult, ReadResult, WriteResult
from deepagents.backends.utils import (
    _get_file_type,
    check_empty_content,
    format_content_with_line_numbers,
    validate_path,
)
from deepagents.middleware.filesystem import (
    DEFAULT_READ_LIMIT,
    DEFAULT_READ_OFFSET,
    EDIT_FILE_TOOL_DESCRIPTION,
    NUM_CHARS_PER_TOKEN,
    READ_FILE_TOOL_DESCRIPTION,
    WRITE_FILE_TOOL_DESCRIPTION,
    EditFileSchema,
    FilesystemMiddleware,
    FilesystemState,
    ReadFileSchema,
    WriteFileSchema,
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

from src.db.session import sqlite_db_session
from src.service.agent.path_authorization import guard_external_write
from src.service.agent.read_file_dedupe import (
    dedupe_read_file_tool_messages,
    inject_excessive_edit_run_stop_hint,
    inject_excessive_read_stop_hint,
    inject_write_already_exists_hint,
)
from src.service.agent.read_file_path_compression import compress_large_read_file_history
from src.service.agent.write_guard_registry import (
    conv_id_from_runtime,
    lookup_write_guard,
)

logger = logging.getLogger(__name__)

# deepagents 默认 read_file 每次只读 100 行（DEFAULT_READ_LIMIT），大文件被切成
# 几十段；叠加 deepagents 自带截断提示“文件太大，考虑重新格式化”——这是误导，
# 模型既读不完又不知该用 offset 续读，于是反复 read 前 100 行陷入死循环
# （观测到“读取报告.md”刷十几遍）。把默认 limit 放大到 2000 行，绝大多数文档
# 一次读完，从源头消除“因分页而反复读取”的循环。
LARGE_READ_LIMIT = 2000

# 覆盖 deepagents 自带的 read 工具描述。原描述写死“默认 100 行”、还手把手
# 教模型“先 limit=100 扫一遍、再 offset 分段读”——本地小模型照做，把一个几百
# 行的文件读十几次，陷入“反复读取”的卡死。这里改成：默认一次读完整个文件，
# 只有超大文件才分页，从源头消除不必要的分段读取。
_READ_FILE_TOOL_DESCRIPTION_OVERRIDE = (
    "读取一个文件的内容。\n\n"
    "用法：\n"
    "- **默认一次性读取整个文件**（最多 2000 行），不要分段小步读取。\n"
    "- 绝大多数文档/报告/代码一次就能读完，读完后请直接基于内容继续任务，"
    "不要重复读取同一个文件。\n"
    "- 仅当文件**极大**（明确收到「文件未读完」或「内容已截断」提示）时，才用 offset 读取后续部分"
    "（offset 设为已读末尾行号），且不要重复读已读过的区间。\n"
    "- **禁止**根据「本次读到的末行号」推断文件总行数；只有 footer 明确写「文件已读完」才算读毕。\n"
    "- 结果以 cat -n 格式返回，带行号。\n"
    "- 图片/音频/视频/PDF 作为多模态内容返回，不要对其使用 offset/limit。\n"
)

# 截断时给模型的明确续读指引（替换 deepagents 那条会误导的提示）。
_READ_CONTINUE_HINT = (
    "\n\n[内容较长已截断。要继续阅读后续部分，请用更大的 offset 再次 "
    "read_file（offset 设为当前已读的末尾行号）；不要重复读取同一段。]"
)


def format_read_progress_footer(
    *,
    validated_path: str,
    offset: int,
    raw_line_count: int,
    truncated: bool,
    requested_limit: int,
    total_file_lines: int | None = None,
    has_more: bool | None = None,
) -> str:
    """在每次 read_file 结果末尾标注行号区间，避免模型把「本次读到的末行」当成文件总行数。"""
    if raw_line_count <= 0:
        return ""

    start_line = offset + 1
    end_line = offset + raw_line_count
    next_offset = offset + raw_line_count

    if truncated:
        has_more = True
    elif has_more is None:
        if total_file_lines is not None:
            has_more = end_line < total_file_lines
        else:
            has_more = raw_line_count >= requested_limit

    if total_file_lines is not None:
        progress = f"文件共 {total_file_lines} 行，已读至第 {end_line} 行"
    else:
        progress = f"本次读取行号 {start_line}-{end_line}（offset={offset}，返回 {raw_line_count} 行）"

    if has_more:
        tail = (
            f"⚠ 文件未读完（{progress}）。"
            f"第 {end_line} 行不是文件末尾，必须继续 read_file offset={next_offset}；"
            f"在收到「文件已读完」提示前，禁止断言已读毕或估算文件总行数。"
        )
    else:
        tail = (
            f"{progress}；文件已读完。"
            f"请直接基于上文继续任务，勿再 read_file。"
        )

    return f"\n\n[read_file 进度 · {validated_path} · {tail}]"

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
                                f"请在设置中切换到视觉模型后重试]"
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
        raw_line_count = len(content.splitlines()) if content else 0
        truncated_body = truncate(formatted, validated_path, limit)
        truncated = _READ_CONTINUE_HINT in truncated_body
        pagination_meta = getattr(read_result, "pagination_meta", None) or {}
        footer = format_read_progress_footer(
            validated_path=validated_path,
            offset=offset,
            raw_line_count=raw_line_count,
            truncated=truncated,
            requested_limit=limit,
            total_file_lines=pagination_meta.get("total_lines"),
            has_more=pagination_meta.get("has_more"),
        )
        return ToolMessage(
            content=truncated_body + footer,
            name="read_file",
            tool_call_id=tool_call_id,
            additional_kwargs={
                "read_file_path": validated_path,
                "read_file_offset": offset,
                "read_file_limit": limit,
            },
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


def _prepare_read_file_messages_for_llm(
    messages: list[BaseMessage],
) -> list[BaseMessage]:
    messages = dedupe_read_file_tool_messages(messages)
    # 反复读同一文件时注入“停止读取”强指令，掐断本地模型的读取循环
    messages = inject_excessive_read_stop_hint(messages)
    # 反复「改脚本→跑→报错→再改」时注入“换思路”强指令，掐断 edit/shell 循环
    messages = inject_excessive_edit_run_stop_hint(messages)
    # write_file 报 already exists → 强制引导 edit_file，避免「重写却反复创建」死循环
    messages = inject_write_already_exists_hint(messages)
    return compress_large_read_file_history(messages)


def run_write_guard(
    target: str,
    conversation_id: int | None,
    *,
    tool_call_id: str | None,
    tool_name: str,
) -> ToolMessage | None:
    """工作区外目录写守卫桥。

    返回 ToolMessage(status="error")=挡回（调用方直接 return 它）；返回 None=放行。
    fail-open：注册表里查不到本会话的 ctx（含 conversation_id 为 None）→ 放行，
    避免无 conversation 的路径（如非流式工具调用）被误挡。
    """
    ctx = lookup_write_guard(conversation_id)
    if ctx is None:
        return None
    with sqlite_db_session() as db:
        hint = guard_external_write(
            target,
            db=db,
            workspace_id=ctx.workspace_id,
            conversation_id=conversation_id,
            roots=ctx.roots,
        )
    if hint:
        return ToolMessage(
            content=hint,
            name=tool_name,
            tool_call_id=tool_call_id,
            status="error",
        )
    return None


class OpenAICompatibleFilesystemMiddleware(FilesystemMiddleware):
    """read_file 结果与 DashScope 兼容：禁止向模型发送 type=file 内容块。"""

    def wrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler: Callable[[ModelRequest[ContextT]], ModelResponse[ResponseT]],
    ) -> ModelResponse[ResponseT]:
        allow_images = active_model_supports_vision()
        messages = _prepare_read_file_messages_for_llm(list(request.messages))
        messages = sanitize_messages_for_openai_compatible(
            messages,
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
        messages = _prepare_read_file_messages_for_llm(list(request.messages))
        messages = sanitize_messages_for_openai_compatible(
            messages,
            allow_images=allow_images,
        )
        if messages != list(request.messages):
            request = request.override(messages=messages)
        return await super().awrap_model_call(request, handler)

    def _create_read_file_tool(self) -> BaseTool:
        # 优先用户自定义；否则用我们的“默认整读、勿分段”描述（不再用 deepagents
        # 那段教模型分页小步读、导致反复读取的原始描述）。
        tool_description = (
            self._custom_tool_descriptions.get("read_file")
            or _READ_FILE_TOOL_DESCRIPTION_OVERRIDE
        )
        token_limit = self._tool_token_limit_before_evict

        def _truncate(content: str, file_path: str, limit: int) -> str:
            lines = content.splitlines(keepends=True)
            if len(lines) > limit:
                lines = lines[:limit]
                content = "".join(lines)

            if token_limit and len(content) >= NUM_CHARS_PER_TOKEN * token_limit:
                # 用明确的“offset 续读”指引替换 deepagents 那条会误导模型的
                # “文件太大，考虑重新格式化”提示（后者导致模型反复读同一段）。
                truncation_msg = _READ_CONTINUE_HINT
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
                "Maximum number of lines to read (default 2000, 一般一次即可读完整个文件). "
                "Use offset for pagination only if explicitly truncated.",
            ] = LARGE_READ_LIMIT,
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
                "Maximum number of lines to read (default 2000, 一般一次即可读完整个文件). "
                "Use offset for pagination only if explicitly truncated.",
            ] = LARGE_READ_LIMIT,
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

    def _create_write_file_tool(self) -> BaseTool:
        """覆盖基类 write_file：照搬基类工厂体，validate_path 成功后插工作区外写守卫。"""
        tool_description = (
            self._custom_tool_descriptions.get("write_file")
            or WRITE_FILE_TOOL_DESCRIPTION
        )

        def sync_write_file(
            file_path: Annotated[
                str,
                "Absolute path where the file should be created. Must be absolute, not relative.",
            ],
            content: Annotated[
                str, "The text content to write to the file. This parameter is required."
            ],
            runtime: ToolRuntime[None, FilesystemState],
        ) -> ToolMessage:
            """Synchronous wrapper for write_file tool."""
            resolved_backend = self._get_backend(runtime)
            try:
                validated_path = validate_path(file_path)
            except ValueError as e:
                return ToolMessage(
                    content=f"Error: {e}",
                    name="write_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )

            if _check_fs_permission(self._permissions, "write", validated_path) == "deny":
                return ToolMessage(
                    content=f"Error: permission denied for write on {validated_path}",
                    name="write_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            conv_id = conv_id_from_runtime(runtime)
            blocked = run_write_guard(
                validated_path,
                conv_id,
                tool_call_id=runtime.tool_call_id,
                tool_name="write_file",
            )
            if blocked is not None:
                return blocked
            res: WriteResult = resolved_backend.write(validated_path, content)
            if res.error:
                return ToolMessage(
                    content=res.error,
                    name="write_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            return ToolMessage(
                content=f"Updated file {res.path}",
                name="write_file",
                tool_call_id=runtime.tool_call_id,
                status="success",
            )

        async def async_write_file(
            file_path: Annotated[
                str,
                "Absolute path where the file should be created. Must be absolute, not relative.",
            ],
            content: Annotated[
                str, "The text content to write to the file. This parameter is required."
            ],
            runtime: ToolRuntime[None, FilesystemState],
        ) -> ToolMessage:
            """Asynchronous wrapper for write_file tool."""
            resolved_backend = self._get_backend(runtime)
            try:
                validated_path = validate_path(file_path)
            except ValueError as e:
                return ToolMessage(
                    content=f"Error: {e}",
                    name="write_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )

            if _check_fs_permission(self._permissions, "write", validated_path) == "deny":
                return ToolMessage(
                    content=f"Error: permission denied for write on {validated_path}",
                    name="write_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            conv_id = conv_id_from_runtime(runtime)
            blocked = run_write_guard(
                validated_path,
                conv_id,
                tool_call_id=runtime.tool_call_id,
                tool_name="write_file",
            )
            if blocked is not None:
                return blocked
            res: WriteResult = await resolved_backend.awrite(validated_path, content)
            if res.error:
                return ToolMessage(
                    content=res.error,
                    name="write_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            return ToolMessage(
                content=f"Updated file {res.path}",
                name="write_file",
                tool_call_id=runtime.tool_call_id,
                status="success",
            )

        return StructuredTool.from_function(
            name="write_file",
            description=tool_description,
            func=sync_write_file,
            coroutine=async_write_file,
            infer_schema=False,
            args_schema=WriteFileSchema,
        )

    def _create_edit_file_tool(self) -> BaseTool:
        """覆盖基类 edit_file：照搬基类工厂体，validate_path 成功后插工作区外写守卫。"""
        tool_description = (
            self._custom_tool_descriptions.get("edit_file")
            or EDIT_FILE_TOOL_DESCRIPTION
        )

        def sync_edit_file(
            file_path: Annotated[
                str, "Absolute path to the file to edit. Must be absolute, not relative."
            ],
            old_string: Annotated[
                str,
                "The exact text to find and replace. Must be unique in the file unless replace_all is True.",
            ],
            new_string: Annotated[
                str,
                "The text to replace old_string with. Must be different from old_string.",
            ],
            runtime: ToolRuntime[None, FilesystemState],
            *,
            replace_all: Annotated[
                bool,
                "If True, replace all occurrences of old_string. If False (default), old_string must be unique.",
            ] = False,
        ) -> ToolMessage:
            """Synchronous wrapper for edit_file tool."""
            resolved_backend = self._get_backend(runtime)
            try:
                validated_path = validate_path(file_path)
            except ValueError as e:
                return ToolMessage(
                    content=f"Error: {e}",
                    name="edit_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )

            if _check_fs_permission(self._permissions, "write", validated_path) == "deny":
                return ToolMessage(
                    content=f"Error: permission denied for write on {validated_path}",
                    name="edit_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            conv_id = conv_id_from_runtime(runtime)
            blocked = run_write_guard(
                validated_path,
                conv_id,
                tool_call_id=runtime.tool_call_id,
                tool_name="edit_file",
            )
            if blocked is not None:
                return blocked
            res: EditResult = resolved_backend.edit(
                validated_path, old_string, new_string, replace_all=replace_all
            )
            if res.error:
                return ToolMessage(
                    content=res.error,
                    name="edit_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            return ToolMessage(
                content=f"Successfully replaced {res.occurrences} instance(s) of the string in '{res.path}'",
                name="edit_file",
                tool_call_id=runtime.tool_call_id,
                status="success",
            )

        async def async_edit_file(
            file_path: Annotated[
                str, "Absolute path to the file to edit. Must be absolute, not relative."
            ],
            old_string: Annotated[
                str,
                "The exact text to find and replace. Must be unique in the file unless replace_all is True.",
            ],
            new_string: Annotated[
                str,
                "The text to replace old_string with. Must be different from old_string.",
            ],
            runtime: ToolRuntime[None, FilesystemState],
            *,
            replace_all: Annotated[
                bool,
                "If True, replace all occurrences of old_string. If False (default), old_string must be unique.",
            ] = False,
        ) -> ToolMessage:
            """Asynchronous wrapper for edit_file tool."""
            resolved_backend = self._get_backend(runtime)
            try:
                validated_path = validate_path(file_path)
            except ValueError as e:
                return ToolMessage(
                    content=f"Error: {e}",
                    name="edit_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )

            if _check_fs_permission(self._permissions, "write", validated_path) == "deny":
                return ToolMessage(
                    content=f"Error: permission denied for write on {validated_path}",
                    name="edit_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            conv_id = conv_id_from_runtime(runtime)
            blocked = run_write_guard(
                validated_path,
                conv_id,
                tool_call_id=runtime.tool_call_id,
                tool_name="edit_file",
            )
            if blocked is not None:
                return blocked
            res: EditResult = await resolved_backend.aedit(
                validated_path, old_string, new_string, replace_all=replace_all
            )
            if res.error:
                return ToolMessage(
                    content=res.error,
                    name="edit_file",
                    tool_call_id=runtime.tool_call_id,
                    status="error",
                )
            return ToolMessage(
                content=f"Successfully replaced {res.occurrences} instance(s) of the string in '{res.path}'",
                name="edit_file",
                tool_call_id=runtime.tool_call_id,
                status="success",
            )

        return StructuredTool.from_function(
            name="edit_file",
            description=tool_description,
            func=sync_edit_file,
            coroutine=async_edit_file,
            infer_schema=False,
            args_schema=EditFileSchema,
        )


# 物理路径放行：deepagents 原生 validate_path 拒绝本机绝对路径（Windows 盘符 / 非虚拟
# Unix 绝对）。删除独立的 validate_path_shim 后，把放行逻辑并入本模块的安装函数。
# _ORIG_VALIDATE_PATH 在模块导入时绑定原函数（此时 line 24 导入的 validate_path 即原始）。
from src.service.agent.path_access.host_paths import (  # noqa: E402
    is_host_absolute_path,
    normalize_host_path,
)

_ORIG_VALIDATE_PATH = validate_path


def _validate_path_allow_physical(path, *, allowed_prefixes=None):
    """放行本机绝对路径（Windows 盘符 / Unix 绝对）；其余沿用 deepagents 原校验。"""
    if is_host_absolute_path(path):
        return normalize_host_path(path)
    return _ORIG_VALIDATE_PATH(path, allowed_prefixes=allowed_prefixes)


def install_compatible_filesystem_middleware() -> None:
    global _patched, validate_path
    if _patched:
        return
    import deepagents.graph as graph_module
    import deepagents.middleware.filesystem as fs_module
    from deepagents.backends import utils as backend_utils

    fs_module.FilesystemMiddleware = OpenAICompatibleFilesystemMiddleware
    graph_module.FilesystemMiddleware = OpenAICompatibleFilesystemMiddleware

    # 放行本机绝对路径：基类工具（ls/write/edit）调 fs_module.validate_path；
    # 各 backend 调 backend_utils.validate_path；本模块自身 read 用模块全局 validate_path。
    fs_module.validate_path = _validate_path_allow_physical
    backend_utils.validate_path = _validate_path_allow_physical
    validate_path = _validate_path_allow_physical  # rebind 本模块全局（read_file 用）

    _patched = True
    logger.info(
        "Installed OpenAICompatibleFilesystemMiddleware + physical path passthrough"
    )
