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
