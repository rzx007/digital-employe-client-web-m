"""shell 硬底线（command_safety）：灾难级命令永不执行 + 命令归一化防混淆。

重点是**误杀防护**——底线只挡近零误报的灾难操作，绝不能挡正常开发命令。
"""
from __future__ import annotations

import pytest

from src.service.agent.command_safety import check_hardline, normalize_command


# ── 归一化 ────────────────────────────────────────────────────────────────
def test_normalize_unescapes_backslash():
    assert normalize_command(r"r\m -rf /") == "rm -rf /"


def test_normalize_strips_ansi():
    assert normalize_command("\x1b[31mrm\x1b[0m -rf /") == "rm -rf /"


def test_normalize_collapses_empty_quotes_and_spaces():
    assert normalize_command("r''m   -rf    /") == "rm -rf /"


# ── 必须拦截的灾难命令 ────────────────────────────────────────────────────
@pytest.mark.parametrize("cmd", [
    "rm -rf /",
    "rm -rf /*",
    "rm -fr ~",
    "rm -rf $HOME",
    "rm  -r  -f  /",
    "rm -rf --no-preserve-root /",
    "sudo rm -rf /",
    "env FOO=1 rm -rf /",
    "rm -rf //",                        # POSIX: // 等价 /
    'rm -rf "/"*',                      # 引号包裹的根
    "rm -rf ~root",                     # ~user 家目录
    r"r\m -rf /",                       # 混淆
    "mkfs.ext4 /dev/sda1",
    "mkfs /dev/nvme0n1",
    "sudo mkfs.ext4 /dev/sda1",         # 包装前缀绕过(评审 CRITICAL-1)
    "sudo dd if=/dev/zero of=/dev/sda",
    "sudo shutdown -h now",
    "nohup reboot",
    "tee /dev/sda",                     # tee 写块设备(评审 CRITICAL-2)
    "dd if=/dev/zero of=/dev/sda",
    ":(){ :|:& };:",                    # fork bomb
    "shutdown -h now",
    "reboot",
    "poweroff",
    "init 0",
    "echo boom > /dev/sda",
    "chmod -R 000 /",
    "wipefs -a /dev/sda",
])
def test_hardline_blocks_catastrophic(cmd):
    assert check_hardline(cmd) is not None, f"应拦截: {cmd!r}"


# ── 绝不能误杀的正常命令 ──────────────────────────────────────────────────
def _backend(tmp_path):
    from src.service.skill_shell_backend import SkillAwareShellBackend
    skills = tmp_path / "skills"
    skills.mkdir(exist_ok=True)
    return SkillAwareShellBackend(
        root_dir=str(tmp_path), skills_root=skills, draft_root=None,
    )


def test_backend_execute_refuses_catastrophic(tmp_path):
    """接入咽喉：灾难命令在 execute() 处被拒、不执行(exit 126)。"""
    resp = _backend(tmp_path).execute("rm -rf /")
    assert resp.exit_code == 126
    assert "底线" in resp.output


def test_backend_execute_allows_normal(tmp_path):
    resp = _backend(tmp_path).execute("echo hardline-ok")
    assert resp.exit_code == 0
    assert "hardline-ok" in resp.output


@pytest.mark.parametrize("cmd", [
    "rm -rf ./build",
    "rm -rf node_modules",
    "rm -rf /tmp/myapp",               # /tmp/xxx 非根
    "rm -f report.txt",
    "rm -rf build/old dist/",
    "dd if=/dev/zero of=test.img bs=1M count=10",   # of=文件
    "mkfs.fat disk.img",               # 造磁盘镜像(非 /dev)，不应误杀(评审 MEDIUM-1)
    "mkfs.ext4 build/firmware.img",
    "rm -rf ~/cache",                  # 家目录子目录(非家目录本身)
    "tee output.log",                  # tee 写普通文件
    "echo 'rm -rf /'",                 # 字符串里的 rm，非命令位置
    "git commit -m 'reboot the server tonight'",    # 引号里的 reboot
    "chmod -R 755 ./dist",
    "chmod 644 file.txt",
    "mkdir -p build && rm -rf build/cache",
    "python merge.py && ls -la",
    "grep -rf pattern .",              # -rf 但不是 rm
    "cat /dev/null > log.txt",         # 重定向到普通文件
    "docker rm -f mycontainer",        # docker rm 非 rm
])
def test_hardline_allows_normal(cmd):
    assert check_hardline(cmd) is None, f"不应拦截: {cmd!r}"
