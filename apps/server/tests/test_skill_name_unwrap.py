"""LLM 调工具偶发把 skill_name 多套一层 JSON 转义（如 \"workbench-builder\"）→
旧实现直接判「格式非法」。修复后 _normalize_skill_name 先剥外层引号/反斜杠再校验。"""
import pytest

from src.service.local_skill_service import LocalSkillService


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("workbench-builder", "workbench-builder"),       # 正常输入：无操作
        ('"workbench-builder"', "workbench-builder"),     # 单层普通引号
        ('\\"workbench-builder\\"', "workbench-builder"), # 截图那种：转义引号
        ("  workbench-builder  ", "workbench-builder"),   # 仅空白
        ("'data-querys'", "data-querys"),                 # 单引号
        ('""skill_x""', "skill_x"),                       # 多层引号
    ],
)
def test_normalize_strips_overescaped_wrapping(raw, expected):
    assert LocalSkillService._normalize_skill_name(raw) == expected


def test_normalize_still_rejects_truly_invalid():
    from fastapi import HTTPException

    for bad in ["", '""', "  ", "!@#$", "-leading-symbol-ok? no=" ]:
        with pytest.raises(HTTPException):
            LocalSkillService._normalize_skill_name(bad)
