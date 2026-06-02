"""Prepare local images for multimodal LLM requests."""

from __future__ import annotations

import base64
import hashlib
import io
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from src.service.basic_file_reader import (
    DASHSCOPE_MAX_MULTIMODAL_BYTES,
    format_multimodal_size_error,
)

LLM_IMAGE_MAX_SIDE = 1568
LLM_IMAGE_MAX_BYTES = 1_500_000
LLM_IMAGE_SKIP_COMPRESS_BELOW = 512_000
LLM_IMAGE_JPEG_QUALITY_STEPS = (85, 75, 65, 60)
LLM_IMAGE_HISTORY_BYTE_BUDGET = 4_000_000
LLM_IMAGE_HISTORY_MESSAGE_LIMIT = 3

_SHRINK_FACTOR = 0.75
_MIN_SIDE = 512
_CACHE_DIR_NAME = ".llm-cache"


@dataclass(frozen=True)
class PreparedImage:
    base64_data: str
    mime_type: str
    decoded_bytes: int
    source_path: Path
    cache_path: Path | None = None


def to_image_url_block(base64_data: str, mime_type: str) -> dict[str, Any]:
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{mime_type};base64,{base64_data}"},
    }


def _guess_mime_type(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _cache_key(path: Path, *, max_bytes: int, max_side: int) -> str:
    stat = path.stat()
    payload = (
        f"{path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|"
        f"{max_bytes}|{max_side}|{LLM_IMAGE_JPEG_QUALITY_STEPS}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_path(path: Path, *, max_bytes: int, max_side: int) -> Path:
    cache_dir = path.parent / _CACHE_DIR_NAME
    return cache_dir / f"{_cache_key(path, max_bytes=max_bytes, max_side=max_side)}.jpg"


def _encode_base64(raw: bytes) -> str:
    return base64.standard_b64encode(raw).decode("ascii")


def _is_svg(path: Path) -> bool:
    return path.suffix.lower() == ".svg"


def _has_transparency(raw: bytes) -> bool:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            return image.mode in {"RGBA", "LA"} or (
                image.mode == "P" and "transparency" in image.info
            )
    except UnidentifiedImageError:
        return False


def _can_skip_compression(path: Path, raw: bytes, *, max_bytes: int) -> bool:
    if len(raw) > LLM_IMAGE_SKIP_COMPRESS_BELOW or len(raw) > max_bytes:
        return False
    suffix = path.suffix.lower()
    if suffix == ".gif":
        return False
    if suffix == ".png" and _has_transparency(raw):
        return False
    return True


def _resize_to_max_side(image: Image.Image, max_side: int) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= max_side:
        return image.copy()

    scale = max_side / longest
    next_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return image.resize(next_size, Image.Resampling.LANCZOS)


def _to_rgb_with_white_background(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    ):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def _encode_jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def _compress_image(raw: bytes, *, max_bytes: int, max_side: int) -> bytes:
    with Image.open(io.BytesIO(raw)) as original:
        image = _to_rgb_with_white_background(original)

    side = max_side
    while side >= _MIN_SIDE:
        resized = _resize_to_max_side(image, side)
        best: bytes | None = None
        for quality in LLM_IMAGE_JPEG_QUALITY_STEPS:
            candidate = _encode_jpeg(resized, quality)
            best = candidate
            if len(candidate) <= max_bytes:
                return candidate
        if best is not None and len(best) <= max_bytes:
            return best
        side = int(side * _SHRINK_FACTOR)

    return _encode_jpeg(_resize_to_max_side(image, _MIN_SIDE), LLM_IMAGE_JPEG_QUALITY_STEPS[-1])


def prepare_image_for_llm(
    path: Path | str,
    *,
    max_bytes: int = LLM_IMAGE_MAX_BYTES,
    max_side: int = LLM_IMAGE_MAX_SIDE,
    use_cache: bool = True,
) -> PreparedImage:
    image_path = Path(path)
    raw = image_path.read_bytes()
    if len(raw) > DASHSCOPE_MAX_MULTIMODAL_BYTES:
        raise ValueError(format_multimodal_size_error(str(image_path), len(raw)))

    if _is_svg(image_path):
        raise ValueError(f"Error: SVG 图片 {image_path} 暂不支持多模态压缩。")

    if _can_skip_compression(image_path, raw, max_bytes=max_bytes):
        return PreparedImage(
            base64_data=_encode_base64(raw),
            mime_type=_guess_mime_type(image_path),
            decoded_bytes=len(raw),
            source_path=image_path,
        )

    cache_path = _cache_path(image_path, max_bytes=max_bytes, max_side=max_side)
    if use_cache and cache_path.is_file():
        cached = cache_path.read_bytes()
        return PreparedImage(
            base64_data=_encode_base64(cached),
            mime_type="image/jpeg",
            decoded_bytes=len(cached),
            source_path=image_path,
            cache_path=cache_path,
        )

    try:
        compressed = _compress_image(raw, max_bytes=max_bytes, max_side=max_side)
    except UnidentifiedImageError as exc:
        raise ValueError(f"Error: 无法识别图片文件 {image_path}: {exc}") from exc

    if len(compressed) > DASHSCOPE_MAX_MULTIMODAL_BYTES:
        raise ValueError(format_multimodal_size_error(str(image_path), len(compressed)))

    if use_cache:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(compressed)

    return PreparedImage(
        base64_data=_encode_base64(compressed),
        mime_type="image/jpeg",
        decoded_bytes=len(compressed),
        source_path=image_path,
        cache_path=cache_path if use_cache else None,
    )


def prepare_image_bytes_for_llm(
    raw: bytes,
    *,
    source_name: str,
    mime_type: str | None = None,
    max_bytes: int = LLM_IMAGE_MAX_BYTES,
    max_side: int = LLM_IMAGE_MAX_SIDE,
) -> PreparedImage:
    source_path = Path(source_name)
    if len(raw) > DASHSCOPE_MAX_MULTIMODAL_BYTES:
        raise ValueError(format_multimodal_size_error(source_name, len(raw)))

    if _is_svg(source_path):
        raise ValueError(f"Error: SVG 图片 {source_name} 暂不支持多模态压缩。")

    if _can_skip_compression(source_path, raw, max_bytes=max_bytes):
        return PreparedImage(
            base64_data=_encode_base64(raw),
            mime_type=mime_type or _guess_mime_type(source_path),
            decoded_bytes=len(raw),
            source_path=source_path,
        )

    try:
        compressed = _compress_image(raw, max_bytes=max_bytes, max_side=max_side)
    except UnidentifiedImageError as exc:
        raise ValueError(f"Error: 无法识别图片文件 {source_name}: {exc}") from exc

    if len(compressed) > DASHSCOPE_MAX_MULTIMODAL_BYTES:
        raise ValueError(format_multimodal_size_error(source_name, len(compressed)))

    return PreparedImage(
        base64_data=_encode_base64(compressed),
        mime_type="image/jpeg",
        decoded_bytes=len(compressed),
        source_path=source_path,
    )
