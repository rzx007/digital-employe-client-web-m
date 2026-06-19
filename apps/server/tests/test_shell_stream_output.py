from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from src.service.skill_shell_backend import SkillAwareShellBackend


def _backend(tmp_path: Path) -> SkillAwareShellBackend:
    skills = tmp_path / "skills"
    skills.mkdir()
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    return SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=skills,
        draft_root=None,
        timeout=10,
    )


def test_aexecute_captures_output_without_trailing_newline(
    tmp_path: Path,
) -> None:
    backend = _backend(tmp_path)
    if Path("/bin/sh").exists():
        cmd = "printf '{\"code\":0}'"
    else:
        cmd = 'python -c "import sys; sys.stdout.write(\'{\\"code\\":0}\')"'

    response = asyncio.run(backend.aexecute(cmd))
    assert response.exit_code == 0
    assert '{"code":0}' in response.output


def test_execute_captures_output_without_trailing_newline(
    tmp_path: Path,
) -> None:
    backend = _backend(tmp_path)
    cmd = 'python -c "import sys; sys.stdout.write(\'{\\"code\\":0}\')"'
    response = backend.execute(cmd)
    assert response.exit_code == 0
    assert '{"code":0}' in response.output


def test_aexecute_hands_to_background_on_timeout(tmp_path):
    import re

    from src.service.shell_background_registry import (
        get_background_shell_registry,
    )

    backend = _backend(tmp_path)
    # 跑 30s，timeout=1s 且允许后台 → 返回 session_id、不杀、exit_code 非 124。
    # 用持久 event loop（贴近生产：loop 长存，aexecute 应在 ~1s 后台移交即返回，
    # 而非阻塞到子进程结束）。asyncio.run 会在收尾时 join 默认执行器线程，
    # 会把返回拖到子进程结束，无法反映「仍在运行」的真实态，故不能用它。
    cmd = (
        'python -u -c "import time; print(\'start\', flush=True); '
        "time.sleep(30); print('done', flush=True)\""
    )
    loop = asyncio.new_event_loop()
    try:
        resp = loop.run_until_complete(
            backend.aexecute(cmd, timeout=1, allow_background=True)
        )
        assert resp.exit_code != 124
        m = re.search(r"session_id=([0-9a-f]+)", resp.output)
        assert m, f"no session_id in: {resp.output}"
        sid = m.group(1)
        reg = get_background_shell_registry()
        r = reg.poll(sid)
        assert r["found"] is True and r["running"] is True
        # 终止后台进程；kill 会清理临时文件
        reg.kill(sid)
        # 让仍在运行的读取线程收尾（其 finally 会向本 loop 投递哨兵），
        # 收尾后再关闭 loop，避免 call_soon_threadsafe 命中已关闭的 loop
        loop.run_until_complete(asyncio.sleep(0.5))
    finally:
        loop.close()


def test_aexecute_timeout_without_background_still_kills(tmp_path):
    backend = _backend(tmp_path)
    cmd = 'python -u -c "import time; time.sleep(5)"'
    resp = asyncio.run(
        backend.aexecute(cmd, timeout=1, allow_background=False)
    )
    assert resp.exit_code == 124
