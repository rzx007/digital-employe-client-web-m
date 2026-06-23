"""资源管理器过滤内部 scratch 临时文件（如 `_agent_exec_*` 执行脚本）。"""
from pathlib import Path

from src.service.resource_service import ResourceService


def test_list_resources_excludes_agent_exec_scratch(tmp_path: Path):
    # 外部 flat 工作空间：产物平铺在产物根本身
    (tmp_path / "report.html").write_text("<html></html>", encoding="utf-8")
    (tmp_path / "_agent_exec_deadbeef.py").write_text("print(1)", encoding="utf-8")
    (tmp_path / "_agent_exec_cafebabe.py").write_text("print(2)", encoding="utf-8")

    res = ResourceService.list_resources(tmp_path)
    names = [e.name for e in res.artifacts]

    assert "report.html" in names
    assert all(not n.startswith("_agent_exec_") for n in names)


def test_list_resources_keeps_user_underscore_files(tmp_path: Path):
    """只过滤确定的内部前缀，用户命名的 `_` 前缀产物正常展示。"""
    (tmp_path / "_notes.md").write_text("note", encoding="utf-8")

    res = ResourceService.list_resources(tmp_path)
    names = [e.name for e in res.artifacts]

    assert "_notes.md" in names
