"""Tests for PROMPT_CACHE_MODE config_kvs normalization."""

from src.core.config import normalize_prompt_cache_mode


def test_normalize_empty_to_none() -> None:
    assert normalize_prompt_cache_mode(None) is None
    assert normalize_prompt_cache_mode("") is None
    assert normalize_prompt_cache_mode("  ") is None
    assert normalize_prompt_cache_mode("default") is None


def test_normalize_valid_modes() -> None:
    assert normalize_prompt_cache_mode("auto") == "auto"
    assert normalize_prompt_cache_mode("EXPLICIT") == "explicit"
    assert normalize_prompt_cache_mode("off") == "off"


def test_normalize_invalid_returns_none() -> None:
    assert normalize_prompt_cache_mode("bogus") is None
