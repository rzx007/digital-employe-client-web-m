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
