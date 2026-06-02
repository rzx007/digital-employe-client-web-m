from __future__ import annotations

from pathlib import Path

from PIL import Image

from src.service.image_multimodal import (
    LLM_IMAGE_MAX_BYTES,
    prepare_image_for_llm,
    to_image_url_block,
)


def _save_image(path: Path, size: tuple[int, int], *, mode: str = "RGB") -> None:
    image = Image.new(mode, size, (32, 96, 160, 180) if mode == "RGBA" else (32, 96, 160))
    image.save(path)


def _save_noise_image(path: Path, size: tuple[int, int]) -> None:
    Image.effect_noise(size, 100).convert("RGB").save(path)


def test_prepare_image_compresses_large_png(tmp_path: Path) -> None:
    path = tmp_path / "large.png"
    _save_noise_image(path, (1800, 1400))

    prepared = prepare_image_for_llm(path, max_bytes=LLM_IMAGE_MAX_BYTES)

    assert prepared.mime_type == "image/jpeg"
    assert prepared.decoded_bytes <= LLM_IMAGE_MAX_BYTES
    assert prepared.cache_path is not None
    assert prepared.cache_path.is_file()


def test_prepare_image_skips_small_image(tmp_path: Path) -> None:
    path = tmp_path / "small.png"
    _save_image(path, (10, 10))

    prepared = prepare_image_for_llm(path)

    assert prepared.mime_type == "image/png"
    assert prepared.cache_path is None
    assert prepared.decoded_bytes == path.stat().st_size


def test_prepare_image_uses_cache(tmp_path: Path) -> None:
    path = tmp_path / "large.png"
    _save_noise_image(path, (1600, 1200))

    first = prepare_image_for_llm(path)
    second = prepare_image_for_llm(path)

    assert first.cache_path is not None
    assert second.cache_path == first.cache_path
    assert second.decoded_bytes == first.decoded_bytes


def test_prepare_transparent_png_outputs_jpeg(tmp_path: Path) -> None:
    path = tmp_path / "transparent.png"
    _save_image(path, (1600, 1600), mode="RGBA")

    prepared = prepare_image_for_llm(path)

    assert prepared.mime_type == "image/jpeg"
    assert prepared.decoded_bytes <= LLM_IMAGE_MAX_BYTES


def test_to_image_url_block_uses_data_uri() -> None:
    block = to_image_url_block("abc", "image/jpeg")

    assert block["type"] == "image_url"
    assert block["image_url"]["url"] == "data:image/jpeg;base64,abc"
