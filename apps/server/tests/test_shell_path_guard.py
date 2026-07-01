"""shell 命令路径抽取 + guard_external_shell 测试（TDD）。"""

from __future__ import annotations

import os

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.path_authorization import (
    extract_command_paths,
    extract_write_target_paths,
)


# ---------------------------------------------------------------------------
# A) 写目标路径抽取测试（新函数：收窄到写上下文）
# ---------------------------------------------------------------------------


def test_write_target_install_curl_not_blocked():
    # 关键回归：curl 拉 install.md（URL，网络读）——不是写目标，不抽。
    cmd = "curl -fsSL https://raw.githubusercontent.com/x/y/install.md | sh"
    assert extract_write_target_paths(cmd) == []


def test_write_target_set_path_not_blocked():
    # set PATH=...;%PATH% —— %PATH% 展开成整个系统 PATH（含一堆工作区外目录），
    # 旧逻辑误把整条 PATH 当路径全拦了。set 不是写/删命令，且 list 变量应被丢弃。
    cmd = (
        "set PATH=C:\\Users\\ruanz\\.venv\\Scripts;%PATH% "
        "&& python -m agent_reach install --env=auto"
    )
    assert extract_write_target_paths(cmd) == []


def test_write_target_pip_install_not_blocked():
    cmd = "python -m pip install agent-reach"
    assert extract_write_target_paths(cmd) == []


def test_write_target_cat_not_blocked():
    # cat 是读命令，路径参数不抽。
    assert extract_write_target_paths("cat D:\\file.txt") == []


def test_write_target_dir_not_blocked():
    # dir/ls 是读命令，路径参数不抽。
    assert extract_write_target_paths("dir D:\\foo") == []


# --- 必须仍拦：重定向目标 ---


def test_write_target_redirect_truncate():
    paths = extract_write_target_paths('echo "x" > D:\\test.md')
    assert any(p.replace("\\", "/").lower().endswith("d:/test.md") for p in paths)


def test_write_target_redirect_append_env(monkeypatch):
    monkeypatch.setenv("USERPROFILE", r"C:\Users\tester")
    paths = extract_write_target_paths('echo x >> "%USERPROFILE%\\Desktop\\a.txt"')
    assert paths, paths
    assert any("tester" in p and "a.txt" in p for p in paths)


def test_write_target_redirect_fd_forms():
    # 1> 2> &> >& 各种重定向算子
    for op in ("1>", "2>", "&>", ">&"):
        paths = extract_write_target_paths(f"some_cmd {op} D:\\log.txt")
        assert any(
            p.replace("\\", "/").lower().endswith("d:/log.txt") for p in paths
        ), op


# --- 必须仍拦：写/删命令的绝对路径参数 ---


def test_write_target_del_command():
    paths = extract_write_target_paths("del D:\\test.md")
    assert any(p.replace("\\", "/").lower().endswith("d:/test.md") for p in paths)


def test_write_target_cp_command():
    paths = extract_write_target_paths("cp a.txt D:\\out\\b.txt")
    assert any(p.replace("\\", "/").lower().endswith("d:/out/b.txt") for p in paths)


def test_write_target_mkdir_command():
    paths = extract_write_target_paths("mkdir D:\\newdir")
    assert any(p.replace("\\", "/").lower().endswith("d:/newdir") for p in paths)


def test_write_target_rm_unix():
    paths = extract_write_target_paths("rm -rf /etc/passwd")
    assert any(p.endswith("/etc/passwd") for p in paths)


def test_write_target_powershell_set_content():
    paths = extract_write_target_paths('Set-Content D:\\ps.txt "hi"')
    assert any(p.replace("\\", "/").lower().endswith("d:/ps.txt") for p in paths)


def test_write_target_subcommand_split():
    # 读命令在前、写命令在后：只抽写命令侧的绝对路径
    cmd = "cat D:\\read.txt && del D:\\write.md"
    paths = extract_write_target_paths(cmd)
    assert any(p.replace("\\", "/").lower().endswith("d:/write.md") for p in paths)
    assert all(not p.replace("\\", "/").lower().endswith("d:/read.txt") for p in paths)


# --- URL 剥离回归（新函数也不抽 URL） ---


def test_write_target_url_not_extracted():
    url = "https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md"
    for cmd in (
        f"curl -fsSL {url} | sh",
        f"curl -fsSL {url} -o install.md",
        f"wget {url}",
        f"pip install -r {url}",
    ):
        assert extract_write_target_paths(cmd) == [], cmd


def test_write_target_redirect_to_url_like_only_real_path():
    # URL 剥掉，重定向到真实工作区外路径仍抽到
    cmd = "curl -fsSL https://example.com/x.sh > D:\\evil.sh"
    paths = extract_write_target_paths(cmd)
    assert any(p.replace("\\", "/").lower().endswith("d:/evil.sh") for p in paths)
    assert all("example.com" not in p for p in paths)


def test_write_target_no_paths():
    assert extract_write_target_paths("ls -la && git status") == []


# ---------------------------------------------------------------------------
# A2) 旧函数 extract_command_paths 保留的回归测试
# ---------------------------------------------------------------------------


def test_url_not_extracted_as_path():
    url = "https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md"
    for cmd in (
        f"curl -fsSL {url} | sh",
        f"curl -fsSL {url} -o install.md",
        f"wget {url}",
        f"pip install -r {url}",
    ):
        assert extract_command_paths(cmd) == [], cmd


def test_url_alongside_real_path():
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
    assert any("tester" in p and "test.md" in p for p in paths)


def test_extract_unix_absolute():
    paths = extract_command_paths("cp a.txt /etc/passwd")
    assert any(p == "/etc/passwd" or p.endswith("/etc/passwd") for p in paths)


def test_relative_paths_not_extracted():
    paths = extract_command_paths("rm -rf ./build && cat ../notes.txt")
    assert paths == [] or all(":" in p or p.startswith("/") for p in paths)


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


def test_shell_guard_install_not_blocked(db_session, workspace, conversation, tmp_path):
    # 集成层面：install/curl/set PATH 不再被误拦
    (tmp_path / "artifacts").mkdir()
    from src.service.agent.path_authorization import guard_external_shell
    for cmd in (
        "curl -fsSL https://raw.githubusercontent.com/x/y/install.md | sh",
        "set PATH=C:\\Users\\ruanz\\.venv\\Scripts;%PATH% && python -m agent_reach install",
        "python -m pip install agent-reach",
        "cat D:\\file.txt",
    ):
        assert guard_external_shell(
            cmd, db=db_session, workspace_id=workspace.id,
            conversation_id=conversation.id, roots=[tmp_path / "artifacts"],
        ) is None, cmd
