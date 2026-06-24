"""write/read/edit 路径里的 $ARTIFACTS_DIR 等环境变量字面量应被展开为真实路径，
避免 agent 用 prompt 教的 `$ARTIFACTS_DIR/x.json` 时建出名为 $ARTIFACTS_DIR 的目录。"""
from pathlib import Path

from src.service.skill_shell_backend import SkillAwareShellBackend


def _backend(tmp_path: Path) -> SkillAwareShellBackend:
    skills = tmp_path / "skills"
    skills.mkdir()
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    memories = tmp_path / "memories"
    memories.mkdir()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    public_root = tmp_path / "pub"
    public_self = public_root / "self"
    public_self.mkdir(parents=True)
    return SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=skills,
        draft_root=None,
        memories_root=memories,
        uploads_root=None,
        workspace_root=workspace,
        public_dir=public_self,
        public_root=public_root,
        conversation_id=42,
        virtual_mode=False,
    )


def test_write_expands_artifacts_dir(tmp_path):
    b = _backend(tmp_path)
    b.write("$ARTIFACTS_DIR/weibo-hotsearch-data.json", '{"ok":1}')

    # 真实文件应落在 artifacts 目录，而不是名为 $ARTIFACTS_DIR 的子目录
    real = tmp_path / "artifacts" / "weibo-hotsearch-data.json"
    assert real.is_file(), f"expected file at {real}"
    assert not (tmp_path / "artifacts" / "$ARTIFACTS_DIR").exists()
    assert real.read_text(encoding="utf-8") == '{"ok":1}'


def test_write_expands_braced_var(tmp_path):
    b = _backend(tmp_path)
    b.write("${ARTIFACTS_DIR}/sub/x.txt", "hi")
    real = tmp_path / "artifacts" / "sub" / "x.txt"
    assert real.is_file()
    assert real.read_text(encoding="utf-8") == "hi"


def test_read_expands_artifacts_dir(tmp_path):
    b = _backend(tmp_path)
    target = tmp_path / "artifacts" / "r.txt"
    target.write_text("hello", encoding="utf-8")
    out = b.read("$ARTIFACTS_DIR/r.txt")
    # basic_file_read 返回文件内容（可能带行号前缀），只要含原文即可
    assert "hello" in str(out)


def test_plain_absolute_path_unchanged(tmp_path):
    b = _backend(tmp_path)
    abs_path = tmp_path / "artifacts" / "plain.txt"
    b.write(str(abs_path), "x")
    assert abs_path.is_file()
