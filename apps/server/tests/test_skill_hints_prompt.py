"""测试 skills_with_hints 注入提示词（A-3 Part 2）。

缓存安全性：空 hints 时不产生改进线索行——确保不污染可缓存前缀。
"""

from __future__ import annotations

from src.service.agent.prompts import build_system_prompt, build_filesystem_prompt_section


# --------------------------------------------------------------------------- #
# build_filesystem_prompt_section 直接测试
# --------------------------------------------------------------------------- #


def test_hints_line_present_when_skills_with_hints():
    """skills_with_hints 非空时，提示词包含改进线索关键词和技能名。"""
    s = build_filesystem_prompt_section(
        skills_real_path="/x/skills",
        skills_with_hints=["pptx"],
    )
    assert "改进线索" in s, "应包含 '改进线索'"
    assert "pptx" in s, "应包含技能名 pptx"
    assert "update_skill" in s  # 既有的 update_skill 引导仍在


def test_hints_line_absent_when_empty_list():
    """skills_with_hints=[] 时，提示词不含改进线索行——保护 cache-prefix。"""
    s = build_filesystem_prompt_section(
        skills_real_path="/x/skills",
        skills_with_hints=[],
    )
    assert "改进线索" not in s, "空 hints 时不应出现改进线索行"


def test_hints_line_absent_by_default():
    """默认不传 skills_with_hints 时，行为与 [] 完全一致。"""
    s_default = build_filesystem_prompt_section(skills_real_path="/x/skills")
    s_empty = build_filesystem_prompt_section(
        skills_real_path="/x/skills", skills_with_hints=[]
    )
    assert s_default == s_empty, "默认参数与空列表应产生完全相同的输出"


def test_multiple_hints_all_listed():
    """多个有改进线索的技能，都应出现在提示词中。"""
    s = build_filesystem_prompt_section(
        skills_real_path="/x/skills",
        skills_with_hints=["pptx", "docx", "lark-base"],
    )
    assert "pptx" in s
    assert "docx" in s
    assert "lark-base" in s


# --------------------------------------------------------------------------- #
# build_system_prompt 端对端测试
# --------------------------------------------------------------------------- #


def test_build_system_prompt_with_hints():
    """build_system_prompt 透传 skills_with_hints，输出含改进线索。"""
    output = build_system_prompt(
        current_time="t",
        available_skills=["pptx"],
        skills_real_path="/x",
        skills_with_hints=["pptx"],
    )
    assert "改进线索" in output
    assert "pptx" in output


def test_build_system_prompt_empty_hints_no_line():
    """build_system_prompt 空 hints 时不含改进线索行（cache 安全）。"""
    output = build_system_prompt(
        current_time="t",
        available_skills=["pptx"],
        skills_real_path="/x",
        skills_with_hints=[],
    )
    assert "改进线索" not in output


def test_build_system_prompt_default_hints_matches_empty():
    """build_system_prompt 不传 skills_with_hints 与传 [] 产生完全相同输出。"""
    out_default = build_system_prompt(
        current_time="t",
        available_skills=["pptx"],
        skills_real_path="/x",
    )
    out_empty = build_system_prompt(
        current_time="t",
        available_skills=["pptx"],
        skills_real_path="/x",
        skills_with_hints=[],
    )
    assert out_default == out_empty
