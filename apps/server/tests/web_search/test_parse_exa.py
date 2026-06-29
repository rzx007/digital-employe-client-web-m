from src.service.agent.web_search.parsing import parse_exa_sse

GOOD = (
    'event: message\n'
    'data: {"result":{"content":[{"type":"text","text":"Title: A\\nURL: http://a"}]},'
    '"jsonrpc":"2.0","id":1}\n\n'
)


def test_parse_single_frame():
    assert parse_exa_sse(GOOD) == "Title: A\nURL: http://a"


def test_parse_ignores_done_and_noise():
    raw = "data: [DONE]\n" "garbage line\n" + GOOD
    assert "Title: A" in parse_exa_sse(raw)


def test_parse_plain_jsonrpc_without_sse_prefix():
    raw = '{"result":{"content":[{"type":"text","text":"hello"}]},"jsonrpc":"2.0","id":1}'
    assert parse_exa_sse(raw) == "hello"


def test_parse_missing_content_returns_empty():
    assert parse_exa_sse('data: {"result":{}}\n') == ""
    assert parse_exa_sse("") == ""
