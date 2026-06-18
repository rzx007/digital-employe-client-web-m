import json
import pytest
from src.service.agent.orchestrator.tools.workbench import (
    normalize_operations,
    SPAN_PRESETS,
)


def test_span_preset_normalization():
    ops = [{"op": "resize", "blockRef": "销售", "span": "large"}]
    out, errors = normalize_operations(ops, valid_paths={"/artifacts/a.html"})
    assert not errors
    assert out[0]["span"] == {"w": 6, "h": 6}


def test_pin_path_not_exist_is_error():
    ops = [{"op": "pin", "resourcePath": "/artifacts/missing.html"}]
    out, errors = normalize_operations(ops, valid_paths={"/artifacts/a.html"})
    assert errors
    assert "missing.html" in errors[0]
    assert out == []  # 校验失败的 pin 不进归一化结果


def test_pin_existing_path_ok():
    ops = [{"op": "pin", "resourcePath": "/artifacts/a.html", "title": "A"}]
    out, errors = normalize_operations(ops, valid_paths={"/artifacts/a.html"})
    assert not errors
    assert out[0] == {"op": "pin", "resourcePath": "/artifacts/a.html", "title": "A"}


def test_unknown_op_is_error():
    ops = [{"op": "explode", "blockRef": "x"}]
    out, errors = normalize_operations(ops, valid_paths=set())
    assert errors
    assert out == []


def test_non_list_input_raises_value_error():
    with pytest.raises(ValueError):
        normalize_operations({"op": "pin"}, valid_paths=set())
