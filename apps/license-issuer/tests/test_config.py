"""config 路径解析。"""

from __future__ import annotations

from pathlib import Path

import pytest

from license_issuer import config


def test_resolve_private_key_explicit() -> None:
    assert config.resolve_private_key("/tmp/custom.pem") == Path("/tmp/custom.pem")


def test_resolve_private_key_prefers_tool_dir(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    tool_key = tmp_path / "private_key.pem"
    tool_key.write_bytes(b"fake")
    monkeypatch.setattr(config, "tool_install_dir", lambda: tmp_path)
    monkeypatch.setattr(
        config,
        "LEGACY_PRIVATE_KEY",
        tmp_path / "legacy" / "private_key.pem",
    )
    assert config.resolve_private_key(None) == tool_key


def test_resolve_private_key_falls_back_to_legacy(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    legacy = tmp_path / "legacy.pem"
    legacy.write_bytes(b"legacy")
    monkeypatch.setattr(config, "tool_install_dir", lambda: tmp_path / "tool")
    monkeypatch.setattr(config, "LEGACY_PRIVATE_KEY", legacy)
    assert config.resolve_private_key(None) == legacy


def test_resolve_private_key_defaults_to_tool_path_when_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    tool_dir = tmp_path / "tool"
    monkeypatch.setattr(config, "tool_install_dir", lambda: tool_dir)
    monkeypatch.setattr(
        config,
        "LEGACY_PRIVATE_KEY",
        tmp_path / "no-legacy.pem",
    )
    assert config.resolve_private_key(None) == tool_dir / "private_key.pem"
