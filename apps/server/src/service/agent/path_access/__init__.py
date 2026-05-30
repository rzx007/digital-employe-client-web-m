"""path_access：Agent 文件路径访问能力（物理路径放行 + 虚拟前缀映射 + prompt 文案）。

分层：
- config        — 从 AGENT_VIRTUAL_MODE 派生 PathAccessConfig
- host_paths    — 本机绝对路径判定（纯函数，长期保留）
- virtual_paths — 虚拟前缀常量与映射（纯函数，长期保留）
- prompt_rules  — 文件工具 prompt 文案（长期保留）
- validate_path_shim — deepagents monkey-patch（唯一侵入点，可整文件删除）

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
    """server 启动时调用：物理模式下安装 validate_path shim。"""
    cfg = get_path_access_config()
    if not cfg.enable_validate_path_shim:
        logger.info("Agent virtual path mode enabled; validate_path shim skipped")
        return
    from src.service.agent.path_access.validate_path_shim import (
        install_validate_path_shim,
    )

    install_validate_path_shim()
