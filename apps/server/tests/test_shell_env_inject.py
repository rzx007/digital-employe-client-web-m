"""SkillAwareShellBackend 注入产物/技能/记忆等目录的真实路径 env。"""
from pathlib import Path

from src.service.skill_shell_backend import SkillAwareShellBackend


def _backend(tmp_path: Path, with_uploads=True, with_draft=True):
    skills = tmp_path / "skills"
    skills.mkdir()
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    memories = tmp_path / "memories"
    memories.mkdir()
    uploads = tmp_path / "uploads"
    draft = tmp_path / "draft"
    if with_uploads:
        uploads.mkdir()
    if with_draft:
        draft.mkdir()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    public_root = tmp_path / "pub"
    public_self = public_root / "self"
    public_self.mkdir(parents=True)
    return SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=skills,
        draft_root=draft if with_draft else None,
        memories_root=memories,
        uploads_root=uploads if with_uploads else None,
        workspace_root=workspace,
        public_dir=public_self,
        public_root=public_root,
        conversation_id=42,
        virtual_mode=False,
    )


def test_injects_directory_env(tmp_path):
    b = _backend(tmp_path)
    assert b._env["ARTIFACTS_DIR"] == str((tmp_path / "artifacts").resolve())
    assert b._env["SKILLS_DIR"] == str((tmp_path / "skills").resolve())
    assert b._env["MEMORIES_DIR"] == str((tmp_path / "memories").resolve())
    assert b._env["UPLOADS_DIR"] == str((tmp_path / "uploads").resolve())
    assert b._env["SKILLS_DRAFT_DIR"] == str((tmp_path / "draft").resolve())
    assert b._env["CONVERSATION_ID"] == "42"
    assert b._env["WORKSPACE_DIR"] == str((tmp_path / "ws").resolve())
    assert b._env["PUBLIC_DIR"] == str((tmp_path / "pub" / "self").resolve())
    assert b._env["PUBLIC_ROOT"] == str((tmp_path / "pub").resolve())


def test_optional_dirs_absent(tmp_path):
    b = _backend(tmp_path, with_uploads=False, with_draft=False)
    assert "UPLOADS_DIR" not in b._env
    assert "SKILLS_DRAFT_DIR" not in b._env
    # 必有项仍在
    assert "ARTIFACTS_DIR" in b._env
    assert "SKILLS_DIR" in b._env


def test_backend_workspace_root_points_to_shared_desk(tmp_path):
    """backend 收到共享桌只读根时，注入的 WORKSPACE_DIR = 桌根。"""
    skills = tmp_path / "skills"; skills.mkdir()
    artifacts = tmp_path / "desk" / "task-100"; artifacts.mkdir(parents=True)
    desk = tmp_path / "desk"
    b = SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=skills,
        draft_root=None,
        workspace_root=desk,          # 共享桌根
        conversation_id=42,
        virtual_mode=False,
    )
    assert b._env["ARTIFACTS_DIR"] == str(artifacts.resolve())
    assert b._env["WORKSPACE_DIR"] == str(desk.resolve())
