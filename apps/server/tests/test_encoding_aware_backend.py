from pathlib import Path

from src.service.agent.basic_file_backend import EncodingAwareFilesystemBackend
from src.service.agent.paths import _EMPLOYEE_MEMORY_TEMPLATE


def test_download_files_decodes_gbk_agents_md(tmp_path: Path) -> None:
    memory_file = tmp_path / "AGENTS.md"
    memory_file.write_bytes(_EMPLOYEE_MEMORY_TEMPLATE.encode("gbk"))

    backend = EncodingAwareFilesystemBackend(root_dir=str(tmp_path), virtual_mode=True)
    responses = backend.download_files(["/AGENTS.md"])

    assert len(responses) == 1
    assert responses[0].error is None
    assert responses[0].content is not None
    text = responses[0].content.decode("utf-8")
    assert "员工长期记忆" in text
    assert memory_file.read_text(encoding="utf-8")
