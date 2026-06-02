"""Prepare local images for multimodal LLM requests.

Images are first resized by an estimated visual-token budget, then encoded
under the existing byte budget. The default profile follows Qwen3-VL/Hanhai
calibration: patch16 x merge2, so 32 x 32 pixels are roughly one token.
"""

from __future__ import annotations

import base64
import hashlib
import io
import math
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
IMAGE_FACTOR = 32
PX_PER_TOKEN = IMAGE_FACTOR * IMAGE_FACTOR
LLM_IMAGE_MAX_VISUAL_TOKENS = 1024
LLM_IMAGE_MIN_VISUAL_TOKENS = 4
LLM_IMAGE_MULTI_TOTAL_TOKENS = 4096
LLM_IMAGE_MULTI_FLOOR = 512
LLM_IMAGE_MULTI_CAP = 1280

_SHRINK_FACTOR = 0.75
_CACHE_DIR_NAME = ".llm-cache"


@dataclass(frozen=True)
class PreparedImage:
    base64_data: str
    mime_type: str
    decoded_bytes: int
    source_path: Path
    cache_path: Path | None = None
    width: int | None = None
    height: int | None = None
    estimated_visual_tokens: int | None = None


def to_image_url_block(base64_data: str, mime_type: str) -> dict[str, Any]:
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{mime_type};base64,{base64_data}"},
    }


def _guess_mime_type(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _cache_key(
    path: Path,
    *,
    max_bytes: int,
    max_side: int,
    max_visual_tokens: int,
    px_per_token: int,
    image_factor: int,
) -> str:
    stat = path.stat()
    payload = (
        f"{path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|"
        f"{max_bytes}|{max_side}|{max_visual_tokens}|{px_per_token}|"
        f"{image_factor}|{LLM_IMAGE_JPEG_QUALITY_STEPS}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_path(
    path: Path,
    *,
    max_bytes: int,
    max_side: int,
    max_visual_tokens: int,
    px_per_token: int,
    image_factor: int,
) -> Path:
    cache_dir = path.parent / _CACHE_DIR_NAME
    key = _cache_key(
        path,
        max_bytes=max_bytes,
        max_side=max_side,
        max_visual_tokens=max_visual_tokens,
        px_per_token=px_per_token,
        image_factor=image_factor,
    )
    return cache_dir / f"{key}.jpg"


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


def estimate_visual_tokens(
    width: int,
    height: int,
    *,
    px_per_token: int = PX_PER_TOKEN,
    factor: int = IMAGE_FACTOR,
) -> int:
    """Estimate visual tokens after factor alignment."""
    if width <= 0 or height <= 0:
        raise ValueError(f"非法尺寸: {width}x{height}")
    aligned_width = max(factor, round(width / factor) * factor)
    aligned_height = max(factor, round(height / factor) * factor)
    return math.ceil(aligned_width * aligned_height / px_per_token)


def smart_resize(
    width: int,
    height: int,
    *,
    max_tokens: int = LLM_IMAGE_MAX_VISUAL_TOKENS,
    min_tokens: int = LLM_IMAGE_MIN_VISUAL_TOKENS,
    factor: int = IMAGE_FACTOR,
    px_per_token: int = PX_PER_TOKEN,
    no_upscale: bool = True,
) -> tuple[int, int]:
    """Resize dimensions to fit a visual-token budget while preserving ratio."""
    if width <= 0 or height <= 0:
        raise ValueError(f"非法尺寸: {width}x{height}")

    max_pixels = max_tokens * px_per_token
    min_pixels = min_tokens * px_per_token
    aligned_width = max(factor, round(width / factor) * factor)
    aligned_height = max(factor, round(height / factor) * factor)

    if aligned_width * aligned_height > max_pixels:
        scale = math.sqrt((width * height) / max_pixels)
        aligned_width = max(factor, math.floor(width / scale / factor) * factor)
        aligned_height = max(factor, math.floor(height / scale / factor) * factor)
    elif aligned_width * aligned_height < min_pixels and not no_upscale:
        scale = math.sqrt(min_pixels / (width * height))
        aligned_width = math.ceil(width * scale / factor) * factor
        aligned_height = math.ceil(height * scale / factor) * factor

    if no_upscale and (
        aligned_width > width
        or aligned_height > height
        or aligned_width * aligned_height > width * height
    ):
        return width, height

    return max(1, aligned_width), max(1, aligned_height)


def plan_image_budget(
    n_images: int,
    *,
    total_tokens: int = LLM_IMAGE_MULTI_TOTAL_TOKENS,
    floor: int = LLM_IMAGE_MULTI_FLOOR,
    cap: int = LLM_IMAGE_MULTI_CAP,
) -> int:
    """Return per-image visual-token budget for a batch."""
    if n_images <= 1:
        return LLM_IMAGE_MAX_VISUAL_TOKENS
    per_image = total_tokens // n_images
    if per_image >= cap:
        return cap
    if per_image >= LLM_IMAGE_MAX_VISUAL_TOKENS:
        return LLM_IMAGE_MAX_VISUAL_TOKENS
    return floor


def _active_resize_profile() -> tuple[int, int, int]:
    try:
        from src.llm.vision import active_vision_resize_profile

        profile = active_vision_resize_profile()
        return (
            profile.default_max_tokens,
            profile.px_per_token,
            profile.image_factor,
        )
    except Exception:
        return LLM_IMAGE_MAX_VISUAL_TOKENS, PX_PER_TOKEN, IMAGE_FACTOR


def _fits_visual_budget(
    raw: bytes,
    *,
    max_visual_tokens: int,
    px_per_token: int,
    image_factor: int,
) -> bool:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            tokens = estimate_visual_tokens(
                image.width,
                image.height,
                px_per_token=px_per_token,
                factor=image_factor,
            )
            return tokens <= max_visual_tokens
    except (OSError, UnidentifiedImageError):
        return False


def _can_skip_compression(
    path: Path,
    raw: bytes,
    *,
    max_bytes: int,
    max_visual_tokens: int,
    px_per_token: int,
    image_factor: int,
) -> bool:
    if len(raw) > LLM_IMAGE_SKIP_COMPRESS_BELOW or len(raw) > max_bytes:
        return False
    suffix = path.suffix.lower()
    if suffix == ".gif":
        return False
    if suffix == ".png" and _has_transparency(raw):
        return False
    return _fits_visual_budget(
        raw,
        max_visual_tokens=max_visual_tokens,
        px_per_token=px_per_token,
        image_factor=image_factor,
    )


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


def _resize_to_visual_budget(
    image: Image.Image,
    *,
    max_visual_tokens: int,
    px_per_token: int,
    image_factor: int,
) -> Image.Image:
    width, height = smart_resize(
        image.width,
        image.height,
        max_tokens=max_visual_tokens,
        min_tokens=LLM_IMAGE_MIN_VISUAL_TOKENS,
        factor=image_factor,
        px_per_token=px_per_token,
    )
    if (width, height) == image.size:
        return image.copy()
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _compress_image(
    raw: bytes,
    *,
    max_bytes: int,
    max_visual_tokens: int,
    px_per_token: int,
    image_factor: int,
) -> tuple[bytes, int, int, int]:
    with Image.open(io.BytesIO(raw)) as original:
        image = _to_rgb_with_white_background(original)

    token_budget = max_visual_tokens
    min_budget = max(LLM_IMAGE_MIN_VISUAL_TOKENS, 1)
    best: tuple[bytes, Image.Image] | None = None

    while token_budget >= min_budget:
        resized = _resize_to_visual_budget(
            image,
            max_visual_tokens=token_budget,
            px_per_token=px_per_token,
            image_factor=image_factor,
        )
        best: bytes | None = None
        for quality in LLM_IMAGE_JPEG_QUALITY_STEPS:
            candidate = _encode_jpeg(resized, quality)
            best = candidate
            if len(candidate) <= max_bytes:
                tokens = estimate_visual_tokens(
                    resized.width,
                    resized.height,
                    px_per_token=px_per_token,
                    factor=image_factor,
                )
                return candidate, resized.width, resized.height, tokens
        if best is not None:
            fallback = best
            best_image = resized
            best = (fallback, best_image)
        next_budget = int(token_budget * _SHRINK_FACTOR)
        if next_budget >= token_budget:
            next_budget = token_budget - 1
        token_budget = next_budget

    if best is None:
        resized = _resize_to_visual_budget(
            image,
            max_visual_tokens=min_budget,
            px_per_token=px_per_token,
            image_factor=image_factor,
        )
        best = (_encode_jpeg(resized, LLM_IMAGE_JPEG_QUALITY_STEPS[-1]), resized)

    raw_best, image_best = best
    tokens = estimate_visual_tokens(
        image_best.width,
        image_best.height,
        px_per_token=px_per_token,
        factor=image_factor,
    )
    return raw_best, image_best.width, image_best.height, tokens


def prepare_image_for_llm(
    path: Path | str,
    *,
    max_bytes: int = LLM_IMAGE_MAX_BYTES,
    max_side: int = LLM_IMAGE_MAX_SIDE,
    max_visual_tokens: int | None = None,
    px_per_token: int | None = None,
    image_factor: int | None = None,
    use_cache: bool = True,
) -> PreparedImage:
    image_path = Path(path)
    raw = image_path.read_bytes()
    if len(raw) > DASHSCOPE_MAX_MULTIMODAL_BYTES:
        raise ValueError(format_multimodal_size_error(str(image_path), len(raw)))

    if _is_svg(image_path):
        raise ValueError(f"Error: SVG 图片 {image_path} 暂不支持多模态压缩。")

    profile_max_tokens, profile_px_per_token, profile_factor = _active_resize_profile()
    max_visual_tokens = max_visual_tokens or profile_max_tokens
    px_per_token = px_per_token or profile_px_per_token
    image_factor = image_factor or profile_factor

    if _can_skip_compression(
        image_path,
        raw,
        max_bytes=max_bytes,
        max_visual_tokens=max_visual_tokens,
        px_per_token=px_per_token,
        image_factor=image_factor,
    ):
        with Image.open(io.BytesIO(raw)) as image:
            estimated_tokens = estimate_visual_tokens(
                image.width,
                image.height,
                px_per_token=px_per_token,
                factor=image_factor,
            )
            width, height = image.width, image.height
        return PreparedImage(
            base64_data=_encode_base64(raw),
            mime_type=_guess_mime_type(image_path),
            decoded_bytes=len(raw),
            source_path=image_path,
            width=width,
            height=height,
            estimated_visual_tokens=estimated_tokens,
        )

    cache_path = _cache_path(
        image_path,
        max_bytes=max_bytes,
        max_side=max_side,
        max_visual_tokens=max_visual_tokens,
        px_per_token=px_per_token,
        image_factor=image_factor,
    )
    if use_cache and cache_path.is_file():
        cached = cache_path.read_bytes()
        with Image.open(io.BytesIO(cached)) as image:
            estimated_tokens = estimate_visual_tokens(
                image.width,
                image.height,
                px_per_token=px_per_token,
                factor=image_factor,
            )
        return PreparedImage(
            base64_data=_encode_base64(cached),
            mime_type="image/jpeg",
            decoded_bytes=len(cached),
            source_path=image_path,
            cache_path=cache_path,
            width=image.width,
            height=image.height,
            estimated_visual_tokens=estimated_tokens,
        )

    try:
        compressed, width, height, estimated_tokens = _compress_image(
            raw,
            max_bytes=max_bytes,
            max_visual_tokens=max_visual_tokens,
            px_per_token=px_per_token,
            image_factor=image_factor,
        )
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
        width=width,
        height=height,
        estimated_visual_tokens=estimated_tokens,
    )


def prepare_image_bytes_for_llm(
    raw: bytes,
    *,
    source_name: str,
    mime_type: str | None = None,
    max_bytes: int = LLM_IMAGE_MAX_BYTES,
    max_side: int = LLM_IMAGE_MAX_SIDE,
    max_visual_tokens: int | None = None,
    px_per_token: int | None = None,
    image_factor: int | None = None,
) -> PreparedImage:
    source_path = Path(source_name)
    if len(raw) > DASHSCOPE_MAX_MULTIMODAL_BYTES:
        raise ValueError(format_multimodal_size_error(source_name, len(raw)))

    if _is_svg(source_path):
        raise ValueError(f"Error: SVG 图片 {source_name} 暂不支持多模态压缩。")

    profile_max_tokens, profile_px_per_token, profile_factor = _active_resize_profile()
    max_visual_tokens = max_visual_tokens or profile_max_tokens
    px_per_token = px_per_token or profile_px_per_token
    image_factor = image_factor or profile_factor

    if _can_skip_compression(
        source_path,
        raw,
        max_bytes=max_bytes,
        max_visual_tokens=max_visual_tokens,
        px_per_token=px_per_token,
        image_factor=image_factor,
    ):
        with Image.open(io.BytesIO(raw)) as image:
            estimated_tokens = estimate_visual_tokens(
                image.width,
                image.height,
                px_per_token=px_per_token,
                factor=image_factor,
            )
            width, height = image.width, image.height
        return PreparedImage(
            base64_data=_encode_base64(raw),
            mime_type=mime_type or _guess_mime_type(source_path),
            decoded_bytes=len(raw),
            source_path=source_path,
            width=width,
            height=height,
            estimated_visual_tokens=estimated_tokens,
        )

    try:
        compressed, width, height, estimated_tokens = _compress_image(
            raw,
            max_bytes=max_bytes,
            max_visual_tokens=max_visual_tokens,
            px_per_token=px_per_token,
            image_factor=image_factor,
        )
    except UnidentifiedImageError as exc:
        raise ValueError(f"Error: 无法识别图片文件 {source_name}: {exc}") from exc

    if len(compressed) > DASHSCOPE_MAX_MULTIMODAL_BYTES:
        raise ValueError(format_multimodal_size_error(source_name, len(compressed)))

    return PreparedImage(
        base64_data=_encode_base64(compressed),
        mime_type="image/jpeg",
        decoded_bytes=len(compressed),
        source_path=source_path,
        width=width,
        height=height,
        estimated_visual_tokens=estimated_tokens,
    )
