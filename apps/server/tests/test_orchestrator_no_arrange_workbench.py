"""总管不再持有 arrange_workbench 工具，也不再注入工作台编排 prompt 段。"""
from __future__ import annotations

from pathlib import Path


def _read(rel: str) -> str:
    root = Path(__file__).resolve().parents[1]  # apps/server/
    return (root / rel).read_text(encoding="utf-8")


def test_orchestrator_agent_no_arrange_workbench():
    src = _read("src/service/agent/orchestrator/agent.py")
    # 总管工具清单不再列入 arrange_workbench（裸名出现在工具 list 里）
    assert "arrange_workbench," not in src
    # 不再注入工作台编排 prompt 段
    assert "build_workbench_arrange_section" not in src


def test_prompts_module_drops_workbench_section():
    src = _read("src/service/agent/prompts.py")
    assert "def build_workbench_arrange_section" not in src
