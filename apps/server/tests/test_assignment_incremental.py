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


def test_reassign_preserves_locally_modified_assigned(tmp_path, monkeypatch):
    """已分配且本地改进过的技能，再次分配(含它)时不被库版本覆盖。"""
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))

    class _Emp:
        id = 9
    emp = _Emp()
    root = tmp_path / "9" / "skills"
    lib = tmp_path / "lib" / "skl"; lib.mkdir(parents=True); (lib / "SKILL.md").write_text("# lib v1", encoding="utf-8")

    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "skl", "source": "local", "path": str(lib), "id": 1},
    ])
    # 模拟员工私下改进
    (root / "skl" / "SKILL.md").write_text("# improved", encoding="utf-8")
    skill_provenance.set_locally_modified(root / "skl", True)

    # 再次分配(仍含 skl) → 不应重 copy，改进保留
    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "skl", "source": "local", "path": str(lib), "id": 1},
    ])
    assert (root / "skl" / "SKILL.md").read_text(encoding="utf-8") == "# improved"


def test_assign_does_not_overwrite_grown_same_name(tmp_path, monkeypatch):
    """同名 grown 技能存在时，分配库技能不覆盖它。"""
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))

    class _Emp:
        id = 10
    emp = _Emp()
    root = tmp_path / "10" / "skills"
    grown = root / "foo"; grown.mkdir(parents=True); (grown / "SKILL.md").write_text("# grown foo", encoding="utf-8")
    skill_provenance.write_origin(grown, origin="grown:adopted", skill_id=-1)

    lib = tmp_path / "lib" / "foo"; lib.mkdir(parents=True); (lib / "SKILL.md").write_text("# lib foo", encoding="utf-8")
    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "foo", "source": "local", "path": str(lib), "id": 2},
    ])
    assert (grown / "SKILL.md").read_text(encoding="utf-8") == "# grown foo"  # 未被覆盖
    assert skill_provenance.read_origin(grown).origin == "grown:adopted"      # 仍是 grown


def test_assign_skips_skill_without_id(tmp_path, monkeypatch):
    """缺 id 的技能被跳过，不落盘。"""
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))

    class _Emp:
        id = 11
    emp = _Emp()
    root = tmp_path / "11" / "skills"
    lib = tmp_path / "lib" / "noid"; lib.mkdir(parents=True); (lib / "SKILL.md").write_text("# x", encoding="utf-8")
    EmployeeService._save_skills_to_skill_path(emp, [
        {"skillName": "noid", "source": "local", "path": str(lib)},  # 无 id
    ])
    assert not (root / "noid").exists()
