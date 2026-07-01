from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from src.service import agent_message_builder
from src.service.image_multimodal import (
    LLM_IMAGE_MAX_BYTES,
    LLM_IMAGE_MAX_VISUAL_TOKENS,
    PreparedImage,
    estimate_visual_tokens,
    plan_image_budget,
    prepare_image_for_llm,
    smart_resize,
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
    assert prepared.estimated_visual_tokens is not None
    assert prepared.estimated_visual_tokens <= LLM_IMAGE_MAX_VISUAL_TOKENS
    assert prepared.cache_path is not None
    assert prepared.cache_path.is_file()


def test_prepare_image_skips_small_image(tmp_path: Path) -> None:
    path = tmp_path / "small.png"
    _save_image(path, (10, 10))

    prepared = prepare_image_for_llm(path)

    assert prepared.mime_type == "image/png"
    assert prepared.cache_path is None
    assert prepared.decoded_bytes == path.stat().st_size
    assert prepared.width == 10
    assert prepared.height == 10


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
    assert prepared.estimated_visual_tokens is not None
    assert prepared.estimated_visual_tokens <= LLM_IMAGE_MAX_VISUAL_TOKENS


def test_to_image_url_block_uses_data_uri() -> None:
    block = to_image_url_block("abc", "image/jpeg")

    assert block["type"] == "image_url"
    assert block["image_url"]["url"] == "data:image/jpeg;base64,abc"


def test_estimate_visual_tokens_and_smart_resize() -> None:
    assert estimate_visual_tokens(1024, 1024) == 1024

    width, height = smart_resize(1600, 1200, max_tokens=1024)

    assert estimate_visual_tokens(width, height) <= 1024
    assert width <= 1600
    assert height <= 1200


def test_smart_resize_does_not_upscale_small_images() -> None:
    assert smart_resize(10, 10, max_tokens=1024) == (10, 10)


def test_plan_image_budget_uses_visual_token_tiers() -> None:
    assert plan_image_budget(1, total_tokens=4096) == 1024
    assert plan_image_budget(3, total_tokens=4096) == 1280
    assert plan_image_budget(4, total_tokens=4096) == 1024
    assert plan_image_budget(6, total_tokens=4096) == 512


def test_prepare_image_respects_visual_token_budget(tmp_path: Path) -> None:
    path = tmp_path / "large.png"
    _save_noise_image(path, (1800, 1400))

    prepared = prepare_image_for_llm(path, max_visual_tokens=512)

    assert prepared.mime_type == "image/jpeg"
    assert prepared.estimated_visual_tokens is not None
    assert prepared.estimated_visual_tokens <= 512


def test_build_image_blocks_uses_multi_image_budget(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifacts_root = tmp_path / "artifacts"
    upload_dir = artifacts_root / "1" / "uploads"
    upload_dir.mkdir(parents=True)
    files = []
    for index in range(6):
        filename = f"image-{index}.png"
        _save_image(upload_dir / filename, (32, 32))
        files.append({"path": f"/uploads/{filename}", "name": filename})

    seen_tokens: list[int | None] = []

    def fake_prepare_image_for_llm(
        path: Path | str,
        *,
        max_visual_tokens: int | None = None,
        **_kwargs: object,
    ) -> PreparedImage:
        seen_tokens.append(max_visual_tokens)
        return PreparedImage(
            base64_data="abc",
            mime_type="image/jpeg",
            decoded_bytes=3,
            source_path=Path(path),
            width=32,
            height=32,
            estimated_visual_tokens=1,
        )

    monkeypatch.setattr(
        agent_message_builder,
        "prepare_image_for_llm",
        fake_prepare_image_for_llm,
    )

    blocks, used_bytes, fallback_texts = (
        agent_message_builder.build_image_blocks_from_files(
            files,
            artifacts_root=artifacts_root,
            conversation_id=1,
            allow_images=True,
        )
    )

    assert len(blocks) == 6
    assert used_bytes == 18
    assert fallback_texts == []
    assert seen_tokens == [512] * 6
