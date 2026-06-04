from src.service.agent.compatible_filesystem_middleware import format_read_progress_footer


def test_footer_requires_continue_when_full_page_without_total() -> None:
    footer = format_read_progress_footer(
        validated_path="/artifacts/report.md",
        offset=100,
        raw_line_count=100,
        truncated=False,
        requested_limit=100,
    )
    assert "未读完" in footer
    assert "offset=200" in footer
    assert "禁止断言已读毕" in footer
    assert "共 100 行" not in footer


def test_footer_shows_total_lines_and_requires_continue() -> None:
    footer = format_read_progress_footer(
        validated_path="/artifacts/report.md",
        offset=100,
        raw_line_count=100,
        truncated=False,
        requested_limit=100,
        total_file_lines=350,
        has_more=True,
    )
    assert "文件共 350 行" in footer
    assert "已读至第 200 行" in footer
    assert "未读完" in footer
    assert "offset=200" in footer


def test_footer_shows_done_when_at_eof() -> None:
    footer = format_read_progress_footer(
        validated_path="/artifacts/report.md",
        offset=250,
        raw_line_count=50,
        truncated=False,
        requested_limit=100,
        total_file_lines=300,
        has_more=False,
    )
    assert "文件共 300 行" in footer
    assert "已读至第 300 行" in footer
    assert "文件已读完" in footer
    assert "offset=" not in footer


def test_footer_requires_continue_when_truncated() -> None:
    footer = format_read_progress_footer(
        validated_path="/artifacts/report.md",
        offset=200,
        raw_line_count=300,
        truncated=True,
        requested_limit=300,
    )
    assert "未读完" in footer
    assert "offset=500" in footer
