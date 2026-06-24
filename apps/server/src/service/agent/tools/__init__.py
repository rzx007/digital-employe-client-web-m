"""通用 agent 工具（不绑定总管/员工）。"""
from __future__ import annotations

from src.service.agent.tools.workbench import (
    arrange_workbench,
    save_to_resource_pool,
)

__all__ = ["arrange_workbench", "save_to_resource_pool"]
