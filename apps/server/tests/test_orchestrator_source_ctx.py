"""orchestrator_source ContextVar：set / get / reset 往返。"""

from __future__ import annotations

from src.service.agent.orchestrator.runtime import (
    get_orchestrator_source,
    reset_context,
    set_context,
    set_orchestrator_source,
)


def test_source_ctx_default_is_none() -> None:
    # 干净上下文（先复位）默认 None
    reset_context()
    assert get_orchestrator_source() is None


def test_set_get_source_roundtrip() -> None:
    set_orchestrator_source("feishu")
    assert get_orchestrator_source() == "feishu"
    set_orchestrator_source(None)
    assert get_orchestrator_source() is None


def test_reset_context_clears_source() -> None:
    set_orchestrator_source("feishu")
    assert get_orchestrator_source() == "feishu"
    reset_context()
    assert get_orchestrator_source() is None
