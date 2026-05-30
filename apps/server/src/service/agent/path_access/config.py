"""路径访问配置：从 AGENT_VIRTUAL_MODE 派生各开关。"""

from __future__ import annotations

import os
from dataclasses import dataclass


def is_virtual_mode_enabled() -> bool:
    """AGENT_VIRTUAL_MODE=1 时强制虚拟路径（沙箱/回退）；默认 0（物理）。"""
    return os.getenv("AGENT_VIRTUAL_MODE", "0").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


@dataclass(slots=True, frozen=True)
class PathAccessConfig:
    """单机桌面默认 physical：放行本机绝对路径，shell 走物理 cwd。"""

    virtual_mode_enabled: bool

    @property
    def shell_physical(self) -> bool:
        """传给 LocalShellBackend 的 virtual_mode 取反（physical 时 virtual_mode=False）。"""
        return not self.virtual_mode_enabled

    @property
    def enable_validate_path_shim(self) -> bool:
        """是否需要 monkey-patch deepagents 的 validate_path 放行本机路径。"""
        return not self.virtual_mode_enabled


def get_path_access_config() -> PathAccessConfig:
    return PathAccessConfig(virtual_mode_enabled=is_virtual_mode_enabled())
