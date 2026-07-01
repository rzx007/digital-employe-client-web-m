from pathlib import Path

from src.service.skill_provenance import (
    read_origin,
    write_origin,
    set_locally_modified,
    scan_employee_skills,
    next_grown_skill_id,
)


def _make_skill(root: Path, name: str) -> Path:
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# skill", encoding="utf-8")
    return d


def test_write_then_read_origin(tmp_path: Path):
    d = _make_skill(tmp_path, "demo")
    write_origin(d, origin="assigned", skill_id=42, prompt="P",
                 display_name_zh="演示", description="d")
    info = read_origin(d)
    assert info.origin == "assigned"
    assert info.skill_id == 42
    assert info.locally_modified is False
    assert info.display_name_zh == "演示"
    assert info.prompt == "P"


def test_read_origin_unmarked_returns_none_origin(tmp_path: Path):
    d = _make_skill(tmp_path, "legacy")
    info = read_origin(d)
    assert info.origin is None  # 未标记 → 待迁移回填


def test_scan_lists_only_skill_dirs(tmp_path: Path):
    skills = tmp_path / "skills"
    _make_skill(skills, "a")
    g = _make_skill(skills, "b")
    write_origin(g, origin="grown:adopted", skill_id=-1)
    (skills / "not-a-skill").mkdir()  # 无 SKILL.md，应被忽略
    names = {s.name for s in scan_employee_skills(skills)}
    assert names == {"a", "b"}


def test_next_grown_skill_id_is_unique_negative(tmp_path: Path):
    skills = tmp_path / "skills"
    a = _make_skill(skills, "a")
    write_origin(a, origin="grown:adopted", skill_id=-1)
    assert next_grown_skill_id(skills) == -2


def test_set_locally_modified_toggles_flag(tmp_path: Path):
    d = _make_skill(tmp_path, "s")
    write_origin(d, origin="assigned", skill_id=1)
    set_locally_modified(d, True)
    assert read_origin(d).locally_modified is True
    set_locally_modified(d, False)
    assert read_origin(d).locally_modified is False
