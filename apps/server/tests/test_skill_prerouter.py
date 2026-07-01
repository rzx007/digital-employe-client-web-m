from src.service.agent.skill_prerouter import (
    match_skills,
    build_route_hint,
)

AVAIL = ["bug-reporter", "docx", "pptx", "feishu-workbench"]


def test_match_hit_and_intersect_available():
    assert match_skills("我想反馈个bug", AVAIL) == ["bug-reporter"]


def test_match_skips_skill_not_available():
    # 命中 env-steward 关键词，但它不在 available -> 不返回
    assert match_skills("帮我装python", ["docx", "pptx"]) == []


def test_match_case_insensitive_substring():
    assert "pptx" in match_skills("做个 PPT", AVAIL)


def test_match_no_hit_returns_empty():
    assert match_skills("今天天气怎么样", AVAIL) == []


def test_match_limit_truncates():
    out = match_skills("交易日历的ppt", AVAIL, limit=1)
    assert len(out) == 1


def test_build_route_hint_empty():
    assert build_route_hint([]) == ""


def test_build_route_hint_contains_skill_and_path():
    h = build_route_hint(["bug-reporter"])
    assert "bug-reporter" in h and "/skills/" in h
