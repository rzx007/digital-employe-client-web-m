"""总管委派执行快照与完成摘要。"""

from __future__ import annotations

from src.service.orchestrator_execution_summary import extract_execution_output_text


def test_extract_execution_output_text_from_content():
    raw = '{"content": "微博热搜 TOP1：测试话题"}'
    assert extract_execution_output_text(raw) == "微博热搜 TOP1：测试话题"


def test_extract_execution_output_text_truncates_long_output():
    long_text = "热" * 3000
    raw = f'{{"content": "{long_text}"}}'
    result = extract_execution_output_text(raw, max_chars=100)
    assert result.startswith("热" * 100)
    assert "已截断" in result


def test_extract_execution_output_text_empty():
    assert extract_execution_output_text("{}") == ""
    assert extract_execution_output_text("not-json") == ""
