from src.service.local_skill_service import (
    BUILTIN_SKILL_DISPLAY_NAMES,
    LocalSkillService,
)


def test_builtin_display_name_mapping_covers_known_skills() -> None:
    for skill_name in (
        "lark-base",
        "feishu-workbench",
        "skill-creator",
        "env-steward",
        "html-ppt",
    ):
        assert skill_name in BUILTIN_SKILL_DISPLAY_NAMES


def test_resolve_display_name_zh_prefers_meta() -> None:
    assert (
        LocalSkillService.resolve_display_name_zh(
            "lark-base",
            {"displayNameZh": "自定义名称"},
        )
        == "自定义名称"
    )


def test_resolve_display_name_zh_falls_back_to_mapping() -> None:
    assert (
        LocalSkillService.resolve_display_name_zh("lark-base", None)
        == "飞书多维表格"
    )


def test_resolve_display_name_zh_falls_back_to_skill_name() -> None:
    assert (
        LocalSkillService.resolve_display_name_zh("unknown-skill", None)
        == "unknown-skill"
    )
