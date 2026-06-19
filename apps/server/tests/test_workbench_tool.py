import json
import pytest
from src.service.agent.orchestrator.tools.workbench import (
    ARRANGE_RESULT_MARKER,
    arrange_workbench,
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


def test_malformed_pos_is_error_not_exception():
    # pos.x 为 null/字符串时不能让 int() 抛异常击穿错误字符串契约
    ops = [
        {"op": "move", "blockRef": "A", "pos": {"x": None, "y": 0}},
        {"op": "pin", "resourcePath": "/artifacts/a.html", "pos": {"x": "oops", "y": 1}},
    ]
    out, errors = normalize_operations(ops, valid_paths={"/artifacts/a.html"})
    assert out == []
    assert len(errors) == 2


def test_resize_requires_blockref_and_valid_span():
    out, errors = normalize_operations(
        [{"op": "resize", "span": "large"}], valid_paths=set()
    )
    assert out == [] and errors
    out, errors = normalize_operations(
        [{"op": "resize", "blockRef": "A", "span": "huge"}], valid_paths=set()
    )
    assert out == [] and errors


def test_reorder_order_must_be_string_array():
    out, errors = normalize_operations(
        [{"op": "reorder", "order": [1, 2]}], valid_paths=set()
    )
    assert out == [] and errors
    out, errors = normalize_operations(
        [{"op": "reorder", "order": ["A", "B"]}], valid_paths=set()
    )
    assert not errors
    assert out[0] == {"op": "reorder", "order": ["A", "B"]}


def test_span_dict_form_normalized():
    out, errors = normalize_operations(
        [{"op": "resize", "blockRef": "A", "span": {"w": 4, "h": 5}}],
        valid_paths=set(),
    )
    assert not errors
    assert out[0]["span"] == {"w": 4, "h": 5}


def test_tool_invalid_json_returns_error_string():
    result = arrange_workbench.invoke({"operations": "not json{"})
    assert result.startswith("错误：")


def test_tool_emits_marker_payload_for_frontend():
    # 前端 handler 依赖：摘要行 + 换行 + 带 marker 的 JSON
    ops = json.dumps([{"op": "reorder", "order": ["A", "B"]}])
    result = arrange_workbench.invoke({"operations": ops})
    assert ARRANGE_RESULT_MARKER in result
    payload = json.loads(result.split("\n", 1)[1])
    assert payload["marker"] == ARRANGE_RESULT_MARKER
    assert payload["operations"][0] == {"op": "reorder", "order": ["A", "B"]}
