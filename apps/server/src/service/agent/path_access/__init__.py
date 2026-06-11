"""path_access：Agent 文件路径访问能力（物理路径放行 + 虚拟前缀映射 + prompt 文案）。

分层：
- config        — 从 AGENT_VIRTUAL_MODE 派生 PathAccessConfig
- host_paths    — 本机绝对路径判定（纯函数，长期保留）
- virtual_paths — 虚拟前缀常量与映射（纯函数，长期保留）
- prompt_rules  — 文件工具 prompt 文案（长期保留）

物理路径放行已并入 compatible_filesystem_middleware.install_compatible_filesystem_middleware()
（旧 validate_path_shim 已删除）。

集成层（server / employee / orchestrator）只 import 本模块对外 API。
"""

from __future__ import annotations

import logging

from src.service.agent.path_access.config import (
    PathAccessConfig,
    get_path_access_config,
    is_virtual_mode_enabled,
)

logger = logging.getLogger(__name__)

__all__ = [
    "PathAccessConfig",
    "get_path_access_config",
    "is_virtual_mode_enabled",
    "install",
]


def install() -> None:
    """server 启动时调用。物理路径放行已并入 install_compatible_filesystem_middleware()，
    此处保留为兼容空操作（旧 validate_path_shim 已删除）。"""
    logger.info(
        "Agent physical path mode (validate_path passthrough handled by cfm install)"
    )
