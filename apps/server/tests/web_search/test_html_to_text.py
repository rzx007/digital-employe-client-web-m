from src.service.agent.web_search.parsing import html_to_text


def test_strips_tags_scripts_styles():
    html = (
        "<html><head><style>.x{color:red}</style>"
        "<script>var a=1;</script></head>"
        "<body><h1>标题</h1><p>正文&amp;内容</p></body></html>"
    )
    text = html_to_text(html, max_chars=1000)
    assert "标题" in text and "正文&内容" in text
    assert "color:red" not in text and "var a" not in text
    assert "<" not in text


def test_collapses_whitespace_and_truncates():
    html = "<p>" + ("ab " * 100) + "</p>"
    text = html_to_text(html, max_chars=10)
    assert len(text) <= 10


def test_empty():
    assert html_to_text("", max_chars=100) == ""
