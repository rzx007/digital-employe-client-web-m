"""阶段3：员工成长大脑聚合。"""
import json
from pathlib import Path
from tests.conftest import add_employee


def _seed_brain(brain: Path):
    brain.mkdir(parents=True, exist_ok=True)
    (brain / "profile.md").write_text("# 能力画像\n- 擅长调研", encoding="utf-8")
    (brain / "memories").mkdir(exist_ok=True)
    (brain / "memories" / "AGENTS.md").write_text("## 用户偏好\n§简洁", encoding="utf-8")
    (brain / "skills" / "my-skill").mkdir(parents=True, exist_ok=True)
    (brain / "skills" / "my-skill" / "SKILL.md").write_text("---\nname: my-skill\n---\n", encoding="utf-8")
    jd = brain / "journal"; jd.mkdir(exist_ok=True)
    with (jd / "2026-06-15.jsonl").open("w", encoding="utf-8") as f:
        f.write(json.dumps({"ts": "t1", "task_name": "调研A", "status": "success", "duration_ms": 100}, ensure_ascii=False) + "\n")


def test_build_growth_brain(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(eid))
    _seed_brain(tmp_path / str(emp.id))

    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert "调研" in brain["profile_md"]
    assert "my-skill" in brain["skills_list"]
    assert "简洁" in brain["memories_md"]
    assert brain["journal_entries"] and brain["journal_entries"][0]["task_name"] == "调研A"


def test_build_growth_brain_empty(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="新人")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(emp.id))
    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert brain == {"profile_md": "", "skills_list": [], "memories_md": "", "journal_entries": []}
