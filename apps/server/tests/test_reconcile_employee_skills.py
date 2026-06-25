from pathlib import Path

from sqlalchemy import select

from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.service.employee_service import EmployeeService
from src.service import skill_provenance


def _seed_employee(db_session, tmp_path, monkeypatch) -> Employee:
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    emp = Employee(workspace_id=1, user_id="u1", name="测试员工", employee_code="t1")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    return emp


def _disk_skill(tmp_path, emp_id, name, *, origin, skill_id, content="# c"):
    d = tmp_path / str(emp_id) / "skills" / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(content, encoding="utf-8")
    skill_provenance.write_origin(d, origin=origin, skill_id=skill_id)
    return d


def test_reconcile_inserts_rows_from_disk(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    _disk_skill(tmp_path, emp.id, "alpha", origin="assigned", skill_id=10)
    _disk_skill(tmp_path, emp.id, "beta", origin="grown:adopted", skill_id=-1)
    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()
    rows = db_session.scalars(select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)).all()
    assert {r.skill_name for r in rows} == {"alpha", "beta"}
    by_name = {r.skill_name: r for r in rows}
    assert by_name["alpha"].skill_id == 10
    assert by_name["alpha"].skill_content == "# c"


def test_backfill_negative_id_legacy_row_classified_assigned(db_session, tmp_path, monkeypatch):
    """legacy 无标记目录 + 负 id 的 EmployeeSkill 行(库分配技能 localId 为负)→ 回填为 assigned，
    而非 grown。守护：库分配技能不被迁移误标成成长技能。"""
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    # 无标记目录（模拟 legacy 私有副本）
    d = tmp_path / str(emp.id) / "skills" / "lib-skl"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# c", encoding="utf-8")
    # legacy EmployeeSkill 行：库技能负 localId
    db_session.add(EmployeeSkill(
        workspace_id=1, user_id="u1", employee_id=emp.id, skill_id=-101, skill_name="lib-skl"))
    db_session.commit()

    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()

    info = skill_provenance.read_origin(d)
    assert info.origin == "assigned"   # 不是 grown:adopted
    assert info.skill_id == -101       # 复用原负 id，不分配新合成 id


def test_reconcile_deletes_rows_without_disk(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    _disk_skill(tmp_path, emp.id, "alpha", origin="assigned", skill_id=10)
    db_session.add(EmployeeSkill(workspace_id=1, user_id="u1", employee_id=emp.id, skill_id=99, skill_name="ghost"))
    db_session.commit()
    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()
    names = {r.skill_name for r in db_session.scalars(select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)).all()}
    assert names == {"alpha"}


def test_reconcile_backfills_unmarked_dir(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    d = tmp_path / str(emp.id) / "skills" / "legacy"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# c", encoding="utf-8")
    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()
    info = skill_provenance.read_origin(d)
    assert info.origin is not None


def test_reconcile_is_idempotent(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    _disk_skill(tmp_path, emp.id, "alpha", origin="assigned", skill_id=10)
    _disk_skill(tmp_path, emp.id, "beta", origin="grown:adopted", skill_id=-1)
    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()
    EmployeeService.reconcile_employee_skills(db_session, emp)  # second call
    db_session.commit()
    rows = db_session.scalars(select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)).all()
    assert sorted(r.skill_name for r in rows) == ["alpha", "beta"]  # no duplicates


def test_reconcile_backfills_multiple_unmarked_dirs_with_distinct_ids(db_session, tmp_path, monkeypatch):
    emp = _seed_employee(db_session, tmp_path, monkeypatch)
    for n in ("u1", "u2"):
        d = tmp_path / str(emp.id) / "skills" / n
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text("# c", encoding="utf-8")
    EmployeeService.reconcile_employee_skills(db_session, emp)
    db_session.commit()
    ids = [skill_provenance.read_origin(tmp_path / str(emp.id) / "skills" / n).skill_id for n in ("u1", "u2")]
    assert ids[0] != ids[1]  # distinct negative ids
    assert all(i is not None and i < 0 for i in ids)
