"""技能候选的「采纳 / 忽略」动作（人确认才把候选转为正式技能）。"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from tests.conftest import add_employee

_CAND = (
    "---\nname: chip-research\nzh: 芯片调研报告\ndescription: 标准化调研流程\n"
    "status: candidate\n---\n\n# 芯片调研报告\n## 步骤\n1. 查规格\n"
)


def _seed_candidate(brain: Path, slug: str = "chip-research", body: str = _CAND):
    cand = brain / "skill_candidates"
    cand.mkdir(parents=True, exist_ok=True)
    (cand / f"{slug}.md").write_text(body, encoding="utf-8")


def test_adopt_candidate_moves_to_active_skills(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    brain = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain)
    _seed_candidate(brain)

    out = es.EmployeeService.adopt_skill_candidate(db_session, emp.id, "chip-research")
    assert out == {"adopted": "chip-research"}

    skill_md = brain / "skills" / "chip-research" / "SKILL.md"
    assert skill_md.is_file()
    assert "芯片调研报告" in skill_md.read_text(encoding="utf-8")
    # 候选被消费掉（不再重复出现）
    assert not (brain / "skill_candidates" / "chip-research.md").exists()


def test_adopt_conflict_when_active_skill_exists(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    brain = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain)
    _seed_candidate(brain)
    active = brain / "skills" / "chip-research"
    active.mkdir(parents=True)
    (active / "SKILL.md").write_text("已有同名技能", encoding="utf-8")

    with pytest.raises(HTTPException) as ei:
        es.EmployeeService.adopt_skill_candidate(db_session, emp.id, "chip-research")
    assert ei.value.status_code == 409
    # 原有技能不被覆盖
    assert (active / "SKILL.md").read_text(encoding="utf-8") == "已有同名技能"


def test_adopt_missing_candidate_404(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(emp.id))
    with pytest.raises(HTTPException) as ei:
        es.EmployeeService.adopt_skill_candidate(db_session, emp.id, "nope")
    assert ei.value.status_code == 404


@pytest.mark.parametrize("bad", ["../etc", "a/b", "..", "UPPER", "with space", ""])
def test_adopt_rejects_illegal_slug(db_session, workspace, monkeypatch, tmp_path, bad):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(emp.id))
    with pytest.raises(HTTPException) as ei:
        es.EmployeeService.adopt_skill_candidate(db_session, emp.id, bad)
    assert ei.value.status_code == 400


def test_dismiss_candidate_deletes_file(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    brain = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain)
    _seed_candidate(brain)

    out = es.EmployeeService.dismiss_skill_candidate(db_session, emp.id, "chip-research")
    assert out == {"dismissed": "chip-research"}
    assert not (brain / "skill_candidates" / "chip-research.md").exists()
    # 不会误建 active 技能
    assert not (brain / "skills" / "chip-research").exists()


def test_dismiss_rejects_illegal_slug(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(emp.id))
    with pytest.raises(HTTPException) as ei:
        es.EmployeeService.dismiss_skill_candidate(db_session, emp.id, "../x")
    assert ei.value.status_code == 400


def test_adopt_endpoint_wiring(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    from src.api import employee_api
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    brain = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain)
    _seed_candidate(brain)
    resp = employee_api.adopt_skill_candidate(emp.id, "chip-research", db=db_session)
    assert resp.data == {"adopted": "chip-research"}
    assert (brain / "skills" / "chip-research" / "SKILL.md").is_file()


def test_dismiss_endpoint_wiring(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    from src.api import employee_api
    emp = add_employee(db_session, workspace.id, name="芯片助手")
    brain = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain)
    _seed_candidate(brain)
    resp = employee_api.dismiss_skill_candidate(emp.id, "chip-research", db=db_session)
    assert resp.data == {"dismissed": "chip-research"}
    assert not (brain / "skill_candidates" / "chip-research.md").exists()
