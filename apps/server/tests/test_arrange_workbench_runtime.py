"""arrange_workbench 迁移后：conversation_id 从注入的 runtime 取（员工/总管通用）。"""
from __future__ import annotations

from src.service.agent.tools.workbench import (
    ARRANGE_RESULT_MARKER,
    build_html_resolver_from_entries,
    normalize_operations,
)


def test_normalize_pin_resolves_real_path():
    entries = [{"name": "sales.html", "path": "/abs/conv-1/sales.html"}]
    resolver = build_html_resolver_from_entries(entries)
    ops, errors = normalize_operations(
        [{"op": "pin", "resourcePath": "sales.html"}], resolver
    )
    assert errors == []
    assert ops == [{"op": "pin", "resourcePath": "/abs/conv-1/sales.html"}]


def test_normalize_rejects_unknown_op():
    resolver = build_html_resolver_from_entries([])
    ops, errors = normalize_operations([{"op": "explode"}], resolver)
    assert ops == []
    assert errors and "未知" in errors[0]


def test_marker_is_stable():
    assert ARRANGE_RESULT_MARKER == "WORKBENCH_ARRANGE_V1"
