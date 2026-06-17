"""2D：profile 回喂路由。"""
from pathlib import Path


def test_read_employee_profile(monkeypatch, tmp_path):
    from src.service.agent.orchestrator import prompts
    monkeypatch.setattr(prompts, "_profile_path_for", lambda eid: tmp_path / str(eid) / "profile.md")
    pf = tmp_path / "42" / "profile.md"
    pf.parent.mkdir(parents=True, exist_ok=True)
    pf.write_text("# 能力画像\n- 擅长芯片调研", encoding="utf-8")

    assert "芯片调研" in prompts._read_employee_profile(42)
    assert prompts._read_employee_profile(99) == ""


def test_build_profiles_section(monkeypatch, tmp_path):
    from src.service.agent.orchestrator import prompts

    class _Emp:
        def __init__(self, id, name): self.id = id; self.name = name

    monkeypatch.setattr(prompts, "_read_employee_profile",
                        lambda eid: "- 擅长X" if eid == 1 else "")
    section = prompts.build_employee_profiles_section([_Emp(1, "甲"), _Emp(2, "乙")])
    assert "能力画像" in section
    assert "甲" in section and "擅长X" in section
    assert "乙" not in section


def test_build_profiles_section_empty_when_none(monkeypatch):
    from src.service.agent.orchestrator import prompts
    monkeypatch.setattr(prompts, "_read_employee_profile", lambda eid: "")
    class _Emp:
        def __init__(self, id, name): self.id = id; self.name = name
    assert prompts.build_employee_profiles_section([_Emp(1, "甲")]) == ""


def test_capability_context_includes_profiles(monkeypatch, db_session, workspace):
    from src.service.agent.orchestrator import prompts
    from tests.conftest import add_employee
    emp = add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(prompts, "_read_employee_profile",
                        lambda eid: "- 擅长芯片调研" if eid == emp.id else "")
    ctx = prompts.build_employee_capability_context(db_session, f"u-ws{workspace.id}", workspace.id)
    assert "| ID | 姓名" in ctx
    assert "能力画像" in ctx
    assert "芯片调研" in ctx


def test_capability_context_no_profiles_unchanged_tail(monkeypatch, db_session, workspace):
    from src.service.agent.orchestrator import prompts
    from tests.conftest import add_employee
    add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(prompts, "_read_employee_profile", lambda eid: "")
    ctx = prompts.build_employee_capability_context(db_session, f"u-ws{workspace.id}", workspace.id)
    assert "| ID | 姓名" in ctx
    assert "能力画像" not in ctx
