import io
import zipfile
from pathlib import Path

from src.service.local_skill_service import LocalSkillService


def _make_draft(tmp_path: Path) -> Path:
    d = tmp_path / "skills-draft" / "demo-skill"
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: demo-skill\ndescription: 演示\n---\n# Demo\n", encoding="utf-8")
    (d / "scripts" / "run.py").write_text("print('hi')\n", encoding="utf-8")
    return d


def test_pack_skill_dir_to_zip_contains_all_files(tmp_path):
    draft = _make_draft(tmp_path)
    data = LocalSkillService.pack_skill_dir_to_zip(draft)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
    # zip 内以技能目录名为根
    assert "demo-skill/SKILL.md" in names
    assert "demo-skill/scripts/run.py" in names


def test_pack_skill_dir_to_zip_rejects_missing_skill_md(tmp_path):
    d = tmp_path / "skills-draft" / "no-md"
    d.mkdir(parents=True)
    (d / "note.txt").write_text("x", encoding="utf-8")
    try:
        LocalSkillService.pack_skill_dir_to_zip(d)
        assert False, "应因缺少 SKILL.md 抛错"
    except Exception:
        pass


def test_get_employee_local_skill_ids_filters_negative(monkeypatch):
    from src.service.employee_service import EmployeeService

    fake_snapshot = [
        {"skill_id": -3, "skillName": "a"},
        {"skill_id": 10, "skillName": "remote-b"},  # 远程正数，排除
        {"skill_id": -7, "skillName": "c"},
    ]
    monkeypatch.setattr(
        EmployeeService, "_employee_skills_snapshot",
        staticmethod(lambda db, employee: fake_snapshot),
    )

    class _Emp:  # 占位，_employee_skills_snapshot 被 mock 不会真用它
        id = 1

    ids = EmployeeService.get_employee_local_skill_ids(db=None, employee=_Emp())
    assert sorted(ids) == [-7, -3]


def test_save_draft_skill_imports_and_returns_localid(tmp_path, monkeypatch):
    draft = _make_draft(tmp_path)

    captured = {}

    def fake_import(skill_name, file_name, file_bytes, overwrite=False, workspace_id=None, display_name_zh=None):
        captured["skill_name"] = skill_name
        captured["workspace_id"] = workspace_id
        return {"skillName": skill_name, "localId": -42, "path": "/x", "overwritten": False}

    monkeypatch.setattr(LocalSkillService, "import_local_skill_zip", staticmethod(fake_import))

    result = LocalSkillService.save_draft_skill(
        draft_dir=draft, skill_name="demo-skill", workspace_id=5, overwrite=False
    )
    assert result["localId"] == -42
    assert result["skillName"] == "demo-skill"
    assert captured["workspace_id"] == 5


def test_resolve_draft_dir_rejects_traversal():
    from src.api.skill_api import _resolve_draft_skill_dir

    try:
        _resolve_draft_skill_dir(conversation_id=1, skill_name="../evil")
        assert False, "应拒绝穿越"
    except Exception:
        pass
