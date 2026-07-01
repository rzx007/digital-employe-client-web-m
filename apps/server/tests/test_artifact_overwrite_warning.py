"""P2-B：共享产物区同名覆盖时记一条告警（非致命，不阻断写入）。"""
from __future__ import annotations

import logging
from pathlib import Path

from src.service.agent.basic_file_backend import basic_file_write


class _FakeArtifactsBackend:
    """最小后端替身：带 _artifacts_dir（同 SkillAwareShellBackend），_resolve_path 拼到产物根。"""

    def __init__(self, artifacts_dir: Path):
        self._artifacts_dir = Path(artifacts_dir).resolve()

    def _resolve_path(self, file_path: str) -> Path:
        return (self._artifacts_dir / file_path).resolve()


def test_new_file_write_no_warning(tmp_path, caplog):
    backend = _FakeArtifactsBackend(tmp_path)
    with caplog.at_level(logging.WARNING):
        res = basic_file_write(backend, "report.docx", "v1")
    assert res.error is None
    assert (tmp_path / "report.docx").read_text(encoding="utf-8") == "v1"
    assert "report.docx" not in caplog.text


def test_overwrite_existing_artifact_warns_and_still_writes(tmp_path, caplog):
    backend = _FakeArtifactsBackend(tmp_path)
    (tmp_path / "report.docx").write_text("员工A的成果", encoding="utf-8")

    with caplog.at_level(logging.WARNING):
        res = basic_file_write(backend, "report.docx", "员工B覆盖")

    # 非致命：写入照常成功（后写覆盖先写）
    assert res.error is None
    assert (tmp_path / "report.docx").read_text(encoding="utf-8") == "员工B覆盖"
    # 但记下了一条撞名/覆盖告警，含文件名
    assert "report.docx" in caplog.text
    assert ("覆盖" in caplog.text) or ("撞名" in caplog.text)


def test_overwrite_outside_artifacts_no_warning(tmp_path, caplog):
    """非产物区（如记忆/草稿）的覆盖不告警——避免正常迭代刷屏。"""
    backend = _FakeArtifactsBackend(tmp_path / "artifacts")
    backend._artifacts_dir.mkdir(parents=True, exist_ok=True)

    other = tmp_path / "memories"
    other.mkdir(parents=True, exist_ok=True)
    target = other / "AGENTS.md"
    target.write_text("旧记忆", encoding="utf-8")

    class _OtherBackend(_FakeArtifactsBackend):
        def _resolve_path(self, file_path: str) -> Path:
            return target

    b = _OtherBackend(tmp_path / "artifacts")
    with caplog.at_level(logging.WARNING):
        res = basic_file_write(b, "AGENTS.md", "新记忆")
    assert res.error is None
    assert "AGENTS.md" not in caplog.text
