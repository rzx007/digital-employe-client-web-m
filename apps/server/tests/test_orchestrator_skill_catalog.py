def test_empty_dir_returns_empty(tmp_path):
    from src.service.orchestrator_skill_catalog import list_orchestrator_skills

    assert list_orchestrator_skills(tmp_path) == []


def test_reads_name_and_description(tmp_path):
    from src.service.orchestrator_skill_catalog import list_orchestrator_skills

    alpha = tmp_path / "alpha"
    alpha.mkdir()
    (alpha / "SKILL.md").write_text(
        "---\nname: alpha\ndescription: 阿尔法技能\n---\n正文\n", encoding="utf-8"
    )
    # 无 frontmatter → 描述降级为空串
    beta = tmp_path / "beta"
    beta.mkdir()
    (beta / "SKILL.md").write_text("没有 frontmatter 的正文\n", encoding="utf-8")
    # 没有 SKILL.md 的目录被忽略
    (tmp_path / "not-a-skill").mkdir()

    out = {d["name"]: d["description"] for d in list_orchestrator_skills(tmp_path)}
    assert out == {"alpha": "阿尔法技能", "beta": ""}
