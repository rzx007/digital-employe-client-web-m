"""Build LangChain-compatible user messages with uploaded attachments."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from src.llm.vision import active_model_supports_vision
from src.service.basic_file_reader import (
    BasicFileCategory,
    categorize_file,
    read_basic_file,
    read_text_with_encoding_fallback,
)
from src.service.image_multimodal import (
    LLM_IMAGE_HISTORY_BYTE_BUDGET,
    LLM_IMAGE_MAX_BYTES,
    plan_image_budget,
    prepare_image_for_llm,
    to_image_url_block,
)

DOCUMENT_TEXT_MAX_CHARS = 8_000
TEXT_FILE_INLINE_MAX_CHARS = 8_000

_UPLOADS_PREFIX = "/uploads/"


def _normalize_files(files: object) -> list[dict[str, Any]]:
    if not isinstance(files, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in files:
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            normalized.append(item)
    return normalized


def _parse_meta(extra_meta: object) -> dict[str, Any]:
    if isinstance(extra_meta, dict):
        return extra_meta
    if isinstance(extra_meta, str) and extra_meta:
        try:
            value = json.loads(extra_meta)
        except json.JSONDecodeError:
            return {}
        return value if isinstance(value, dict) else {}
    return {}


def resolve_upload_path(
    artifacts_root: str | Path,
    conversation_id: int,
    path: str,
) -> Path | None:
    """解析上传文件路径并做 uploads 桶沙箱校验。

    支持两种入参：真实磁盘绝对路径（P2 起 upload_file 返回的形态）；以及旧会话历史里
    遗留的 `/uploads/<name>` 相对形态（读旧数据的兼容，不影响新寻址）。
    """
    conversation_dir = Path(artifacts_root) / str(conversation_id)
    uploads_dir = conversation_dir / "uploads"
    if path.startswith(_UPLOADS_PREFIX):
        target = (conversation_dir / path.lstrip("/")).resolve()
    else:
        try:
            target = Path(path).resolve()
        except OSError:
            return None
    try:
        target.relative_to(uploads_dir.resolve())
    except ValueError:
        return None
    return target


def build_file_context_lines(files: object) -> list[str]:
    lines: list[str] = []
    for file in _normalize_files(files):
        path = str(file.get("path") or "")
        if not path:
            continue
        name = str(file.get("name") or Path(path).name or path)
        lines.append(f"- {name} (路径: {path})")
    return lines


def _truncate_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[内容过长，已截断]"


def _unsupported_image_text(path: str) -> str:
    return (
        f"[当前模型不支持图片理解 ({path})；"
        f"请在设置中切换到视觉模型（如 qwen-vl-max）后重试]"
    )


def _file_text_snippets(
    files: list[dict[str, Any]],
    *,
    artifacts_root: str | Path,
    conversation_id: int,
) -> list[str]:
    """从上传文件中提取文本片段，用于构建Agent消息上下文。

    该函数遍历文件列表，根据文件类型采用不同的策略提取文本内容：
    - 图片文件：跳过不处理
    - 文档文件：使用 read_basic_file 提取文本
    - 文本文件：使用带编码回退的读取方式提取文本

    Args:
        files: 文件信息列表，每个元素为包含 'path' 键的字典，表示文件的虚拟路径
        artifacts_root:  artifacts根目录路径，用于解析文件的实际存储位置
        conversation_id: 会话ID，用于定位特定会话的文件存储目录

    Returns:
        文本片段列表，每个片段格式为 "[附件 {virtual_path} 的文本内容]\n{truncated_text}"
        如果文件无法读取或为图片类型，则不会出现在返回列表中
    """
    snippets: list[str] = []
    for file in files:
        virtual_path = str(file.get("path") or "")
        resolved = resolve_upload_path(artifacts_root, conversation_id, virtual_path)
        if resolved is None or not resolved.is_file():
            continue

        # 根据文件分类决定提取策略
        category = categorize_file(resolved)
        if category == BasicFileCategory.IMAGE:
            continue
        if category == BasicFileCategory.DOCUMENT:
            payload = read_basic_file(resolved)
            if payload.text:
                snippets.append(
                    f"[附件 {virtual_path} 的文本内容]\n"
                    f"{_truncate_text(payload.text, DOCUMENT_TEXT_MAX_CHARS)}"
                )
            continue

        # 尝试读取普通文本文件，支持多种编码格式
        try:
            text = read_text_with_encoding_fallback(resolved)
        except OSError:
            continue
        if text:
            snippets.append(
                f"[附件 {virtual_path} 的文本内容]\n"
                f"{_truncate_text(text, TEXT_FILE_INLINE_MAX_CHARS)}"
            )
    return snippets


def build_image_blocks_from_files(
    files: object,
    *,
    artifacts_root: str | Path,
    conversation_id: int,
    allow_images: bool | None = None,
    remaining_byte_budget: int | None = None,
) -> tuple[list[dict[str, Any]], int, list[str]]:
    """从文件列表中构建图像消息块。

    该函数处理上传的文件，筛选出图像文件并将其转换为适合LLM处理的格式。
    支持字节预算控制，当预算不足时会保留图像路径但不发送像素内容。

    Args:
        files: 文件对象或文件列表，包含待处理的文件信息。
        artifacts_root: 工件根目录路径，用于解析文件的实际存储位置。
        conversation_id: 会话ID，用于定位特定会话的文件目录。
        allow_images: 是否允许处理图像。如果为None，则根据当前模型是否支持视觉能力自动判断。
        remaining_byte_budget: 剩余字节预算，用于限制发送的图像总大小。如果为None则不限制。

    Returns:
        一个三元组，包含：
            - blocks: 图像消息块列表，每个元素是包含base64编码图像数据的字典。
            - used_bytes: 已使用的字节数，即所有成功处理的图像的总大小。
            - fallback_texts: 回退文本列表，包含无法处理的图像的说明文本。

    Note:
        - 非图像文件会被忽略。
        - 当模型不支持图像时，会将图像路径作为文本返回。
        - 当字节预算不足时，会保留图像路径但不发送像素内容。
        - 图像处理失败时，错误信息会添加到回退文本列表中。
    """
    # 如果未指定是否允许图像，则根据当前模型的视觉能力自动判断
    if allow_images is None:
        allow_images = active_model_supports_vision()

    blocks: list[dict[str, Any]] = []
    used_bytes = 0
    fallback_texts: list[str] = []
    image_files: list[tuple[str, Path]] = []

    # 遍历所有文件，筛选并处理图像文件
    for file in _normalize_files(files):
        virtual_path = str(file.get("path") or "")
        resolved = resolve_upload_path(artifacts_root, conversation_id, virtual_path)
        if resolved is None or not resolved.is_file():
            continue
        if categorize_file(resolved) != BasicFileCategory.IMAGE:
            continue
        image_files.append((virtual_path, resolved))

    max_visual_tokens = plan_image_budget(len(image_files))

    for virtual_path, resolved in image_files:
        # 如果模型不支持图像，将图像路径作为回退文本
        if not allow_images:
            fallback_texts.append(_unsupported_image_text(virtual_path))
            continue

        # 检查字节预算是否已耗尽
        if remaining_byte_budget is not None and remaining_byte_budget <= used_bytes:
            fallback_texts.append(
                f"[图片 {virtual_path} 已保留路径，因历史图片预算不足未再次发送像素内容]"
            )
            continue

        # 尝试准备图像数据供LLM使用
        try:
            prepared = prepare_image_for_llm(
                resolved,
                max_visual_tokens=max_visual_tokens,
            )
        except ValueError as exc:
            fallback_texts.append(str(exc).removeprefix("Error: "))
            continue

        # 检查添加当前图像后是否会超出字节预算
        if remaining_byte_budget is not None:
            next_total = used_bytes + prepared.decoded_bytes
            if next_total > remaining_byte_budget:
                fallback_texts.append(
                    f"[图片 {virtual_path} 已保留路径，因历史图片预算不足未再次发送像素内容]"
                )
                continue

        # 将图像添加到消息块并累计已用字节数
        blocks.append(to_image_url_block(prepared.base64_data, prepared.mime_type))
        used_bytes += prepared.decoded_bytes

    return blocks, used_bytes, fallback_texts


def _content_from_parts(text: str, image_blocks: list[dict[str, Any]]) -> str | list[dict[str, Any]]:
    if not image_blocks:
        return text
    return [{"type": "text", "text": text}, *image_blocks]


def build_user_agent_content(
    text: str,
    files: object,
    *,
    artifacts_root: str | Path,
    conversation_id: int,
    allow_images: bool | None = None,
) -> str | list[dict[str, Any]]:
    """构建用户代理消息内容。

    将用户输入的文本、上传的文件和图像整合成适合Agent处理的消息格式。
    支持纯文本内容和包含图像的多模态内容。

    Args:
        text: 用户输入的文本内容
        files: 用户上传的文件对象，可以是单个文件或文件列表
        artifacts_root:  artifacts根目录路径，用于定位文件
        conversation_id: 会话ID，用于标识当前对话上下文
        allow_images: 是否允许在消息中包含图像，None表示使用默认行为

    Returns:
        如果包含图像则返回多模态内容列表（包含文本和图像块），否则返回纯文本字符串
    """
    # 标准化文件输入格式
    normalized_files = _normalize_files(files)
    parts: list[str] = []

    # 构建上传文件的上下文信息行
    file_lines = build_file_context_lines(normalized_files)
    if file_lines:
        parts.append("[上传的文件]:\n" + "\n".join(file_lines))

    # 提取文件中的文本片段并添加到内容部分
    snippets = _file_text_snippets(
        normalized_files,
        artifacts_root=artifacts_root,
        conversation_id=conversation_id,
    )
    parts.extend(snippets)
    parts.append(text)

    # 从文件中构建图像块，并获取无法转换为图像的文件的回退文本
    image_blocks, _, fallback_texts = build_image_blocks_from_files(
        normalized_files,
        artifacts_root=artifacts_root,
        conversation_id=conversation_id,
        allow_images=allow_images,
    )
    parts.extend(fallback_texts)
    
    # 合并非空的内容部分，用双换行分隔
    content_text = "\n\n".join(part for part in parts if part)
    return _content_from_parts(content_text, image_blocks)


def build_history_user_content(
    message: Any,
    *,
    artifacts_root: str | Path,
    conversation_id: int,
    allow_images: bool,
    remaining_byte_budget: int = LLM_IMAGE_HISTORY_BYTE_BUDGET,
) -> tuple[dict[str, Any], int, bool]:
    """构建历史用户消息内容，支持文件上下文和图片处理。

    该函数从消息中提取元数据、文件和文本内容，将文件信息转换为上下文行，
    并尝试将图片转换为LLM可识别的格式。如果图片转换失败或超出字节预算，
    则使用降级文本替代。

    Args:
        message: 消息对象，包含content、role和extra_meta属性
        artifacts_root: 工件根目录路径，用于定位文件
        conversation_id: 会话ID，用于图片处理上下文
        allow_images: 是否允许在内容中包含图片
        remaining_byte_budget: 剩余字节预算，默认为LLM_IMAGE_HISTORY_BYTE_BUDGET

    Returns:
        tuple包含三个元素：
            - dict: 包含role和content的消息字典
            - int: 已使用的字节数
            - bool: 是否包含图片块
    """
    # 解析消息元数据并提取文件列表和文本内容
    meta = _parse_meta(getattr(message, "extra_meta", None))
    files = _normalize_files(meta.get("files"))
    text = str(getattr(message, "content", "") or "")

    # 如果没有文件，直接返回纯文本内容
    if not files:
        return {"role": getattr(message, "role", "user"), "content": text}, 0, False

    # 构建文件上下文行并组装内容部分
    file_lines = build_file_context_lines(files)
    parts = ["[上传的文件]:\n" + "\n".join(file_lines)] if file_lines else []
    parts.append(text)

    # 从文件中构建图片块，获取降级文本
    image_blocks, used_bytes, fallback_texts = build_image_blocks_from_files(
        files,
        artifacts_root=artifacts_root,
        conversation_id=conversation_id,
        allow_images=allow_images,
        remaining_byte_budget=remaining_byte_budget,
    )
    parts.extend(fallback_texts)

    # 组合所有内容部分生成最终消息
    content = _content_from_parts(
        "\n\n".join(part for part in parts if part),
        image_blocks,
    )
    return (
        {"role": getattr(message, "role", "user"), "content": content},
        used_bytes,
        bool(image_blocks),
    )


def history_image_budget() -> int:
    return LLM_IMAGE_HISTORY_BYTE_BUDGET


def current_image_max_bytes() -> int:
    return LLM_IMAGE_MAX_BYTES
