"""虚拟路径 route 集成：read / write / ls（CompositeBackend）。"""

from pathlib import Path

from deepagents.backends import CompositeBackend, FilesystemBackend

from src.service.agent.basic_file_backend import BasicFileFilesystemBackend
from src.service.skill_shell_backend import SkillAwareShellBackend


def _build_backend(tmp_path: Path) -> CompositeBackend:
    artifacts_dir = tmp_path / "artifacts"
    uploads_dir = tmp_path / "uploads"
    skills_dir = tmp_path / "skills"
    for d in (artifacts_dir, uploads_dir, skills_dir):
        d.mkdir()

    shell = SkillAwareShellBackend(
        root_dir=str(artifacts_dir),
        skills_root=skills_dir,
        draft_root=None,
        uploads_root=uploads_dir,
        virtual_mode=False,
    )
    routes = {
        "/artifacts/": BasicFileFilesystemBackend(
            root_dir=str(artifacts_dir), virtual_mode=True
        ),
        "/uploads/": BasicFileFilesystemBackend(
            root_dir=str(uploads_dir), virtual_mode=True
        ),
        "/skills/": FilesystemBackend(root_dir=str(skills_dir), virtual_mode=True),
    }
    return CompositeBackend(default=shell, routes=routes)


def _read_text(result) -> str:
    assert result.error is None, result.error
    assert result.file_data is not None
    return result.file_data.get("content") or ""


def test_artifacts_read_write_and_ls(tmp_path: Path) -> None:
    backend = _build_backend(tmp_path)

    write_result = backend.write("/artifacts/report.md", "交付物内容")
    assert write_result.error is None

    assert "交付物内容" in _read_text(backend.read("/artifacts/report.md"))

    ls_result = backend.ls("/artifacts/")
    assert ls_result.error is None
    paths = [e["path"] for e in ls_result.entries or []]
    assert "/artifacts/report.md" in paths


def test_uploads_read_and_ls(tmp_path: Path) -> None:
    backend = _build_backend(tmp_path)
    (tmp_path / "uploads" / "photo.txt").write_text("附件", encoding="utf-8")

    assert "附件" in _read_text(backend.read("/uploads/photo.txt"))

    ls_result = backend.ls("/uploads/")
    assert ls_result.error is None
    paths = [e["path"] for e in ls_result.entries or []]
    assert "/uploads/photo.txt" in paths


def test_skills_ls(tmp_path: Path) -> None:
    backend = _build_backend(tmp_path)
    skill_dir = tmp_path / "skills" / "demo-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Demo", encoding="utf-8")

    ls_result = backend.ls("/skills/")
    assert ls_result.error is None
    paths = [e["path"] for e in ls_result.entries or []]
    assert any("demo-skill" in p for p in paths)
