"""prompt 技能引导：update_skill 持久修订 + edit_file 不持久澄清 (A-3)。"""
from src.service.agent.prompts import build_filesystem_prompt_section


def test_update_skill_guidance_present_skills_only():
    """仅有 skills_real_path 时（elif 分支），update_skill 引导须出现。"""
    s = build_filesystem_prompt_section(skills_real_path="/x/skills")
    assert "update_skill" in s


def test_update_skill_guidance_present_draft_branch():
    """has_draft_route=True（if 分支），update_skill 引导须出现。"""
    s = build_filesystem_prompt_section(
        skills_real_path="/x/skills",
        draft_skills_real_path="/x/draft",
        has_draft_route=True,
    )
    assert "update_skill" in s


def test_edit_file_volatile_warning_skills_only():
    """elif 分支：须告知 edit_file 只对当前会话临时生效、不持久。"""
    s = build_filesystem_prompt_section(skills_real_path="/x/skills")
    assert "临时生效" in s
    assert "不持久" in s


def test_edit_file_volatile_warning_draft_branch():
    """if 分支：须告知 edit_file 只对当前会话临时生效、不持久。"""
    s = build_filesystem_prompt_section(
        skills_real_path="/x/skills",
        draft_skills_real_path="/x/draft",
        has_draft_route=True,
    )
    assert "临时生效" in s
    assert "不持久" in s


def test_draft_branch_still_guides_new_skill_creation():
    """if 分支：新技能仍应写到草稿目录（原有引导保留）。"""
    draft_path = "/x/draft"
    s = build_filesystem_prompt_section(
        skills_real_path="/x/skills",
        draft_skills_real_path=draft_path,
        has_draft_route=True,
    )
    assert draft_path in s


def test_old_misleading_wording_absent():
    """旧有误导文案不得再出现（edit_file 修改不再只读 / 可直接 read_file/edit_file 查看与修改）。"""
    for branch_kwargs in [
        {"skills_real_path": "/x/skills"},
        {
            "skills_real_path": "/x/skills",
            "draft_skills_real_path": "/x/draft",
            "has_draft_route": True,
        },
    ]:
        s = build_filesystem_prompt_section(**branch_kwargs)
        assert "不再只读" not in s, "旧误导文案 '不再只读' 仍存在"
        assert "可直接 read_file/edit_file 查看与修改" not in s, (
            "旧误导文案 '可直接 read_file/edit_file 查看与修改' 仍存在"
        )
