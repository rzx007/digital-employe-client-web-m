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
    cand = brain / "skill_candidates"; cand.mkdir(exist_ok=True)
    (cand / "chip-research.md").write_text(
        "---\nname: chip-research\nzh: 芯片调研报告\ndescription: 标准化调研流程\n"
        "status: candidate\n---\n\n# 芯片调研报告\n## 步骤\n1. x\n", encoding="utf-8")
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
    # 技能候选（自动晋升、待人确认）也聚合进成长大脑
    assert brain["skill_candidates"], "应聚合 skill_candidates"
    cand0 = brain["skill_candidates"][0]
    assert cand0["name"] == "chip-research"
    assert cand0["zh"] == "芯片调研报告"
    assert "调研流程" in cand0["description"]


def test_build_growth_brain_empty(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="新人")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(emp.id))
    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert brain == {
        "profile_md": "", "skills_list": [], "memories_md": "",
        "journal_entries": [], "skill_candidates": [], "recent_skill_edits": [],
        "skill_lifecycle": {},
    }


def test_growth_brain_endpoint(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    from src.api import employee_api
    emp = add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(emp.id))
    _seed_brain(tmp_path / str(emp.id))
    resp = employee_api.get_employee_growth_brain(emp.id, db=db_session)
    assert resp.data.profile_md and "调研" in resp.data.profile_md
    assert "my-skill" in resp.data.skills_list
    assert resp.data.journal_entries[0].task_name == "调研A"


# ---------------------------------------------------------------------------
# Fix I-1: recent_skill_edits in growth brain payload
# ---------------------------------------------------------------------------

def test_build_growth_brain_includes_recent_skill_edits(db_session, workspace, monkeypatch, tmp_path):
    """build_employee_growth_brain 应从 skill_edits.jsonl 读取并返回 recent_skill_edits。"""
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="审计员工")
    brain_dir = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)
    _seed_brain(brain_dir)

    # 写入 skill_edits.jsonl（3条记录）
    audit_entries = [
        {"ts": "2026-06-01T10:00:00", "employee_id": emp.id, "skill_name": "pptx", "reason": "缺步骤", "backup_version": "20260601-100000-000000"},
        {"ts": "2026-06-10T12:00:00", "employee_id": emp.id, "skill_name": "xlsx", "reason": "格式错误", "backup_version": None},
        {"ts": "2026-06-20T08:00:00", "employee_id": emp.id, "skill_name": "pptx", "reason": "再次修正", "backup_version": "20260620-080000-000000"},
    ]
    audit_file = brain_dir / "skill_edits.jsonl"
    audit_file.write_text(
        "\n".join(json.dumps(e, ensure_ascii=False) for e in audit_entries) + "\n",
        encoding="utf-8",
    )

    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)

    assert "recent_skill_edits" in brain, "返回字典应含 recent_skill_edits 键"
    edits = brain["recent_skill_edits"]
    assert len(edits) == 3

    # 保持 JSONL 顺序（最新在最后，与 journal_entries 相同约定）
    assert edits[0]["skill_name"] == "pptx"
    assert edits[0]["reason"] == "缺步骤"
    assert edits[2]["skill_name"] == "pptx"
    assert edits[2]["reason"] == "再次修正"

    # 必须含 ts / skill_name / reason / backup_version 四个字段
    for ed in edits:
        assert "ts" in ed
        assert "skill_name" in ed
        assert "reason" in ed
        assert "backup_version" in ed


def test_build_growth_brain_skill_edits_tolerates_missing(db_session, workspace, monkeypatch, tmp_path):
    """skill_edits.jsonl 不存在时 recent_skill_edits 应为空列表，不报错。"""
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="空大脑员工")
    brain_dir = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert brain["recent_skill_edits"] == []


def test_build_growth_brain_skill_edits_bad_line_skipped(db_session, workspace, monkeypatch, tmp_path):
    """skill_edits.jsonl 中有损坏行时，跳过损坏行，只返回合法行。"""
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="坏行员工")
    brain_dir = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)
    brain_dir.mkdir(parents=True, exist_ok=True)

    audit_file = brain_dir / "skill_edits.jsonl"
    audit_file.write_text(
        '{"ts":"2026-06-01T00:00:00","skill_name":"pptx","reason":"ok","backup_version":null}\n'
        "THIS IS NOT JSON\n"
        '{"ts":"2026-06-02T00:00:00","skill_name":"xlsx","reason":"ok2","backup_version":null}\n',
        encoding="utf-8",
    )

    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    edits = brain["recent_skill_edits"]
    assert len(edits) == 2
    assert edits[0]["skill_name"] == "pptx"
    assert edits[1]["skill_name"] == "xlsx"


def test_build_growth_brain_skill_edits_keeps_last_20(db_session, workspace, monkeypatch, tmp_path):
    """skill_edits.jsonl 超过 20 行时只保留最后 20 条。"""
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="多行员工")
    brain_dir = tmp_path / str(emp.id)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)
    brain_dir.mkdir(parents=True, exist_ok=True)

    lines = []
    for i in range(25):
        lines.append(json.dumps({
            "ts": f"2026-06-{i+1:02d}T00:00:00",
            "skill_name": f"skill-{i}",
            "reason": f"r{i}",
            "backup_version": None,
        }, ensure_ascii=False))
    (brain_dir / "skill_edits.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    edits = brain["recent_skill_edits"]
    assert len(edits) == 20
    # 保留最后 20 条（skill-5 到 skill-24）
    assert edits[0]["skill_name"] == "skill-5"
    assert edits[-1]["skill_name"] == "skill-24"
