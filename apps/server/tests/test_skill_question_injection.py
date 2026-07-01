from src.service.chat_service import build_skill_question


def test_no_skill_returns_question_unchanged():
    assert build_skill_question("", "今天几号") == "今天几号"
    assert build_skill_question(None, "今天几号") == "今天几号"


def test_with_skill_prefixes_question():
    # 不再区分 curator/employee：只要给了技能名就注入
    assert (
        build_skill_question("find-skills", "帮我找个技能")
        == "请使用find-skills技能回答这个问题：帮我找个技能"
    )
