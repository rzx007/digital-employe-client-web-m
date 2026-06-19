import json
import pytest
from src.service.agent.orchestrator.tools.workbench import (
    ARRANGE_RESULT_MARKER,
    arrange_workbench,
    build_html_resolver_from_entries,
    normalize_operations,
    SPAN_PRESETS,
)


# 真实存储布局下的产物路径（员工/总管工作空间模型），用于测试解析器。
# 形如 <root>/employee-orchestrator/artifacts/conv-691/weibo-dashboard.html
_REAL = "C:/Users/x/.digital-employee/conversations/employee-orchestrator/artifacts/conv-691/weibo-dashboard.html"


def _resolver(mapping):
    """构造一个 resolve_path 函数：命中返回真实绝对路径，否则 None。"""
    return lambda ref: mapping.get(ref)


def test_span_preset_normalization():
    ops = [{"op": "resize", "blockRef": "销售", "span": "large"}]
    out, errors = normalize_operations(ops, _resolver({}))
    assert not errors
    assert out[0]["span"] == {"w": 6, "h": 6}


def test_pin_resolves_filename_to_real_absolute_path():
    # 这是修复的核心：模型只给文件名，工具必须解析成真实绝对磁盘路径（前端 content API 要的）。
    ops = [{"op": "pin", "resourcePath": "weibo-dashboard.html", "title": "微博看板"}]
    out, errors = normalize_operations(
        ops, _resolver({"weibo-dashboard.html": _REAL})
    )
    assert not errors, errors
    assert out[0]["op"] == "pin"
    assert out[0]["resourcePath"] == _REAL  # 必须是真实绝对路径，不是文件名/虚拟路径
    assert out[0]["title"] == "微博看板"


def test_pin_path_not_exist_is_error_and_lists_available():
    ops = [{"op": "pin", "resourcePath": "missing.html"}]
    out, errors = normalize_operations(
        ops, _resolver({"weibo-dashboard.html": _REAL})
    )
    assert errors
    assert "missing.html" in errors[0]
    assert out == []  # 校验失败的 pin 不进归一化结果


def test_unknown_op_is_error():
    ops = [{"op": "explode", "blockRef": "x"}]
    out, errors = normalize_operations(ops, _resolver({}))
    assert errors
    assert out == []


def test_non_list_input_raises_value_error():
    with pytest.raises(ValueError):
        normalize_operations({"op": "pin"}, _resolver({}))


def test_malformed_pos_is_error_not_exception():
    # pos.x 为 null/字符串时不能让 int() 抛异常击穿错误字符串契约
    ops = [
        {"op": "move", "blockRef": "A", "pos": {"x": None, "y": 0}},
        {"op": "pin", "resourcePath": "weibo-dashboard.html", "pos": {"x": "oops", "y": 1}},
    ]
    out, errors = normalize_operations(
        ops, _resolver({"weibo-dashboard.html": _REAL})
    )
    assert out == []
    assert len(errors) == 2


def test_resize_requires_blockref_and_valid_span():
    out, errors = normalize_operations(
        [{"op": "resize", "span": "large"}], _resolver({})
    )
    assert out == [] and errors
    out, errors = normalize_operations(
        [{"op": "resize", "blockRef": "A", "span": "huge"}], _resolver({})
    )
    assert out == [] and errors


def test_reorder_order_must_be_string_array():
    out, errors = normalize_operations(
        [{"op": "reorder", "order": [1, 2]}], _resolver({})
    )
    assert out == [] and errors
    out, errors = normalize_operations(
        [{"op": "reorder", "order": ["A", "B"]}], _resolver({})
    )
    assert not errors
    assert out[0] == {"op": "reorder", "order": ["A", "B"]}


def test_span_dict_form_normalized():
    out, errors = normalize_operations(
        [{"op": "resize", "blockRef": "A", "span": {"w": 4, "h": 5}}],
        _resolver({}),
    )
    assert not errors
    assert out[0]["span"] == {"w": 4, "h": 5}


def test_pin_error_lists_available_filenames():
    # resolver 找不到时，错误应列出当前可钉的 .html 文件名，让模型一步自纠。
    resolve = build_html_resolver_from_entries(
        [{"name": "weibo-dashboard.html", "path": _REAL}]
    )
    out, errors = normalize_operations(
        [{"op": "pin", "resourcePath": "xiaohongshu.html"}], resolve
    )
    assert out == []
    assert "weibo-dashboard.html" in errors[0]


def test_resolver_matches_by_filename_basename_and_fullpath():
    # 解析器从 ResourceService 的条目（name + 真实绝对 path）建索引，
    # 支持模型给「文件名 / basename / 完整真实路径」任一形式命中。
    entries = [
        {"name": "weibo-dashboard.html", "path": _REAL},
        {"name": "notes.txt", "path": "/x/notes.txt"},  # 非 html 应被忽略
    ]
    resolve = build_html_resolver_from_entries(entries)
    assert resolve("weibo-dashboard.html") == _REAL  # 按文件名
    assert resolve(_REAL) == _REAL  # 按完整真实路径
    assert resolve("notes.txt") is None  # 非 .html 不被收录
    assert resolve("missing.html") is None


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
