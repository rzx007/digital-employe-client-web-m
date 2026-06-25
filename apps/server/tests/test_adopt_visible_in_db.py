from sqlalchemy import select

from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.service.employee_service import EmployeeService, _growth_brain_root_for
from src.service import skill_provenance
import src.service.employee_service as _emp_svc_mod


def test_adopt_candidate_becomes_employee_skill_row(db_session, tmp_path, monkeypatch):
    # Monkeypatch _resolve_skill_root so reconcile_employee_skills writes to tmp_path.
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    # Monkeypatch _growth_brain_root_for so adopt_skill_candidate also resolves to tmp_path/<id>.
    monkeypatch.setattr(
        _emp_svc_mod,
        "_growth_brain_root_for",
        lambda employee_id: tmp_path / str(employee_id),
    )

    emp = Employee(workspace_id=1, user_id="u1", name="员工", employee_code="t1")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    brain = tmp_path / str(emp.id)  # = _growth_brain_root_for(emp.id)
    cand = brain / "skill_candidates"
    cand.mkdir(parents=True)
    (cand / "my-skill.md").write_text("# My Skill\ncontent", encoding="utf-8")

    EmployeeService.adopt_skill_candidate(db_session, emp.id, "my-skill")
    db_session.commit()

    rows = db_session.scalars(
        select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)
    ).all()
    assert any(r.skill_name == "my-skill" for r in rows)  # 档案可见

    skill_dir = brain / "skills" / "my-skill"
    assert skill_provenance.read_origin(skill_dir).origin == "grown:adopted"


def test_adopt_is_best_effort_when_reconcile_fails(db_session, tmp_path, monkeypatch):
    """投影失败不致命：采纳仍成功、技能仍落盘（由后续 reconcile 自愈）。"""
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    monkeypatch.setattr(
        _emp_svc_mod,
        "_growth_brain_root_for",
        lambda employee_id: tmp_path / str(employee_id),
    )

    def _boom(*a, **k):
        raise RuntimeError("reconcile exploded")

    monkeypatch.setattr(EmployeeService, "reconcile_employee_skills", staticmethod(_boom))

    emp = Employee(workspace_id=1, user_id="u1", name="员工", employee_code="t2")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    brain = tmp_path / str(emp.id)
    cand = brain / "skill_candidates"
    cand.mkdir(parents=True)
    (cand / "my-skill.md").write_text("# My Skill", encoding="utf-8")

    result = EmployeeService.adopt_skill_candidate(db_session, emp.id, "my-skill")

    assert result == {"adopted": "my-skill"}  # 未 500
    assert (brain / "skills" / "my-skill" / "SKILL.md").is_file()  # 技能已落盘
