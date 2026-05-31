from pathlib import Path

from src.service.agent.memory_file import append_memory_entry
from src.service.agent.paths import _EMPLOYEE_MEMORY_TEMPLATE


def test_append_memory_replaces_placeholder(tmp_path: Path) -> None:
    memory_file = tmp_path / "AGENTS.md"
    memory_file.write_text(_EMPLOYEE_MEMORY_TEMPLATE, encoding="utf-8")

    changed, message = append_memory_entry(
        memory_file,
        section="fact",
        text="运行环境: Windows，路径用 D:/ 或 C:/",
    )

    assert changed is True
    assert "已写入" in message
    content = memory_file.read_text(encoding="utf-8")
    assert "（暂无）" not in content.split("## 已知事实与约定")[1].split("---")[0]
    assert "- 运行环境: Windows，路径用 D:/ 或 C:/" in content


def test_append_memory_dedupes(tmp_path: Path) -> None:
    memory_file = tmp_path / "AGENTS.md"
    memory_file.write_text(_EMPLOYEE_MEMORY_TEMPLATE, encoding="utf-8")

    append_memory_entry(memory_file, section="preference", text="回复用中文")
    changed, message = append_memory_entry(
        memory_file, section="preference", text="回复用中文"
    )

    assert changed is False
    assert "已存在" in message
    assert memory_file.read_text(encoding="utf-8").count("回复用中文") == 1


def test_append_memory_appends_second_bullet(tmp_path: Path) -> None:
    memory_file = tmp_path / "AGENTS.md"
    memory_file.write_text(_EMPLOYEE_MEMORY_TEMPLATE, encoding="utf-8")

    append_memory_entry(memory_file, section="fact", text="第一条")
    changed, _ = append_memory_entry(memory_file, section="fact", text="第二条")

    assert changed is True
    section_body = (
        memory_file.read_text(encoding="utf-8")
        .split("## 已知事实与约定")[1]
        .split("---")[0]
    )
    assert "- 第一条" in section_body
    assert "- 第二条" in section_body


def test_ensure_memory_file_utf8_converts_gbk(tmp_path: Path) -> None:
    from src.service.agent.memory_file import ensure_memory_file_utf8

    memory_file = tmp_path / "AGENTS.md"
    memory_file.write_bytes(_EMPLOYEE_MEMORY_TEMPLATE.encode("gbk"))

    assert ensure_memory_file_utf8(memory_file) is True
    memory_file.read_text(encoding="utf-8")


def test_append_memory_reads_gbk_existing_file(tmp_path: Path) -> None:
    memory_file = tmp_path / "AGENTS.md"
    memory_file.write_bytes(_EMPLOYEE_MEMORY_TEMPLATE.encode("gbk"))

    changed, message = append_memory_entry(
        memory_file,
        section="fact",
        text="运行环境: Windows",
    )

    assert changed is True
    assert "已写入" in message
    content = memory_file.read_text(encoding="utf-8")
    assert "- 运行环境: Windows" in content


def test_decode_memory_bytes_gbk() -> None:
    from src.service.agent.memory_file import decode_memory_bytes

    raw = _EMPLOYEE_MEMORY_TEMPLATE.encode("gbk")
    text = decode_memory_bytes(raw)
    assert "员工长期记忆" in text


def test_normalize_all_memory_files(tmp_path: Path) -> None:
    from src.service.agent.memory_file import normalize_all_memory_files

    memory_file = tmp_path / "5" / "memories" / "AGENTS.md"
    memory_file.parent.mkdir(parents=True)
    memory_file.write_bytes(_EMPLOYEE_MEMORY_TEMPLATE.encode("gbk"))

    assert normalize_all_memory_files(tmp_path) == 1
    memory_file.read_text(encoding="utf-8")
