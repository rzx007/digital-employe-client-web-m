from src.models.employee import Employee
from src.service.agent.update_skill_tool import _apply_skill_update
from src.service.employee_service import EmployeeService
from src.service import skill_provenance


def test_update_skill_writes_private_copy_only(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    import src.service.local_skill_service as lss
    import src.service.employee_service as es
    monkeypatch.setattr(lss.LocalSkillService, "update_local_skill",
                        staticmethod(lambda *a, **k: (_ for _ in ()).throw(AssertionError("库不应被写"))))
    monkeypatch.setattr(es.EmployeeService, "sync_local_skill_to_assignees",
                        staticmethod(lambda *a, **k: (_ for _ in ()).throw(AssertionError("不应广播"))))
    monkeypatch.setattr("src.db.session.get_session_local", lambda: (lambda: db_session))

    emp = Employee(workspace_id=1, user_id="u1", name="员工", employee_code="t1")
    db_session.add(emp); db_session.commit(); db_session.refresh(emp)
    d = tmp_path / str(emp.id) / "skills" / "skl"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# old", encoding="utf-8")
    skill_provenance.write_origin(d, origin="assigned", skill_id=3)

    out = _apply_skill_update(emp.id, "skl", "# new content", "修了个错")

    assert "失败" not in out
    assert (d / "SKILL.md").read_text(encoding="utf-8") == "# new content"
    assert skill_provenance.read_origin(d).locally_modified is True


def test_update_skill_rejects_missing_private_copy(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    monkeypatch.setattr("src.db.session.get_session_local", lambda: (lambda: db_session))
    emp = Employee(workspace_id=1, user_id="u1", name="员工", employee_code="t2")
    db_session.add(emp); db_session.commit(); db_session.refresh(emp)
    out = _apply_skill_update(emp.id, "ghost", "# x", "r")
    assert "私有副本不存在" in out
