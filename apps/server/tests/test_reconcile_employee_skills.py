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
