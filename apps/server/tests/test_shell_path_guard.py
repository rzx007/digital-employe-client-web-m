"""shell 命令路径抽取 + guard_external_shell 测试（TDD）。"""

from __future__ import annotations

import os

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.path_authorization import extract_command_paths


# ---------------------------------------------------------------------------
# A) 路径抽取测试
# ---------------------------------------------------------------------------


def test_url_not_extracted_as_path():
    # 回归：https:// 的 s: 曾被误当盘符 s:\，//host 被误当绝对路径，
    # 导致 curl/wget 安装命令被误拦。URL 必须整段剥掉、不抽成路径。
    url = "https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md"
    for cmd in (
        f"curl -fsSL {url} | sh",
        f"curl -fsSL {url} -o install.md",
        f"wget {url}",
        f"pip install -r {url}",
    ):
        assert extract_command_paths(cmd) == [], cmd


def test_url_alongside_real_path():
    # URL 剥掉，但同命令里真实的工作区外绝对路径仍要抽到。
    cmd = "curl -fsSL https://example.com/x.sh -o D:\\evil.sh"
    paths = extract_command_paths(cmd)
    assert any(p.replace("\\", "/").lower().endswith("d:/evil.sh") for p in paths)
    assert all("example.com" not in p for p in paths)


def test_extract_windows_drive_path():
    paths = extract_command_paths('echo "x" > D:\\out.txt')
    assert any(p.replace("\\", "/").lower().endswith("d:/out.txt") for p in paths)


def test_extract_forward_slash_drive_path():
    paths = extract_command_paths("python -c \"open('D:/out.txt','w')\"")
    assert any("D:/out.txt" in p or "D:\\out.txt" in p for p in paths)


def test_extract_env_var_path(monkeypatch):
    monkeypatch.setenv("USERPROFILE", r"C:\Users\tester")
    paths = extract_command_paths('echo x > "%USERPROFILE%\\Desktop\\test.md"')
    # 展开后应含 C:\Users\tester\Desktop\test.md
    assert any("tester" in p and "test.md" in p for p in paths)


def test_extract_unix_absolute():
    paths = extract_command_paths("cp a.txt /etc/passwd")
    assert any(p == "/etc/passwd" or p.endswith("/etc/passwd") for p in paths)


def test_relative_paths_not_extracted():
    paths = extract_command_paths("rm -rf ./build && cat ../notes.txt")
    assert paths == [] or all(":" in p or p.startswith("/") for p in paths)  # 无相对路径


def test_no_paths():
    assert extract_command_paths("ls -la && git status") == []


# ---------------------------------------------------------------------------
# B) guard_external_shell 测试
# ---------------------------------------------------------------------------


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="shell守卫测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def test_shell_guard_blocks_external_write(db_session, workspace, conversation, tmp_path):
    (tmp_path / "artifacts").mkdir()
    from src.service.agent.path_authorization import guard_external_shell
    msg = guard_external_shell(
        f'echo x > "{tmp_path}/other/evil.txt"',
        db=db_session, workspace_id=workspace.id,
        conversation_id=conversation.id, roots=[tmp_path / "artifacts"],
    )
    assert msg and "request_external_dir_access" in msg


def test_shell_guard_allows_internal(db_session, workspace, conversation, tmp_path):
    (tmp_path / "artifacts").mkdir()
    from src.service.agent.path_authorization import guard_external_shell
    msg = guard_external_shell(
        f'echo x > "{tmp_path}/artifacts/ok.txt"',
        db=db_session, workspace_id=workspace.id,
        conversation_id=conversation.id, roots=[tmp_path / "artifacts"],
    )
    assert msg is None


def test_shell_guard_no_paths_allows(db_session, workspace, conversation, tmp_path):
    (tmp_path / "artifacts").mkdir()
    from src.service.agent.path_authorization import guard_external_shell
    assert guard_external_shell("ls -la", db=db_session, workspace_id=workspace.id,
        conversation_id=conversation.id, roots=[tmp_path / "artifacts"]) is None
