from src.service.employee_service import EmployeeService
from src.service import skill_provenance


def test_incremental_assign_preserves_grown(tmp_path, monkeypatch):
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))

    class _Emp:
        id = 7
    emp = _Emp()
    root = tmp_path / "7" / "skills"

    grown = root / "grown-skill"
    grown.mkdir(parents=True)
    (grown / "SKILL.md").write_text("# grown", encoding="utf-8")
    skill_provenance.write_origin(grown, origin="grown:adopted", skill_id=-1)

    lib = tmp_path / "lib" / "lib-skill"
    lib.mkdir(parents=True)
    (lib / "SKILL.md").write_text("# lib", encoding="utf-8")
    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "lib-skill", "source": "local", "path": str(lib), "id": 5},
    ])

    assert (grown / "SKILL.md").is_file()  # 成长技能未被冲掉
    assert (root / "lib-skill" / "SKILL.md").is_file()
    assert skill_provenance.read_origin(root / "lib-skill").origin == "assigned"


def test_incremental_assign_removes_deselected_assigned(tmp_path, monkeypatch):
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))

    class _Emp:
        id = 8
    emp = _Emp()
    root = tmp_path / "8" / "skills"
    lib_a = tmp_path / "lib" / "a"; lib_a.mkdir(parents=True); (lib_a / "SKILL.md").write_text("# a", encoding="utf-8")
    lib_b = tmp_path / "lib" / "b"; lib_b.mkdir(parents=True); (lib_b / "SKILL.md").write_text("# b", encoding="utf-8")

    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "a", "source": "local", "path": str(lib_a), "id": 1},
        {"skillName": "b", "source": "local", "path": str(lib_b), "id": 2},
    ])
    assert (root / "a").is_dir() and (root / "b").is_dir()

    # 再分配只留 a → b(assigned) 应被删
    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "a", "source": "local", "path": str(lib_a), "id": 1},
    ])
    assert (root / "a").is_dir()
    assert not (root / "b").exists()
