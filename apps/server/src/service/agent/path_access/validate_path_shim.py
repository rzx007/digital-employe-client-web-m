"""唯一的 deepagents 侵入点：monkey-patch validate_path 放行本机绝对路径。

deepagents 的 middleware 层 validate_path 会硬性拒绝 Windows 盘符 / 非虚拟的 Unix
绝对路径，与 FilesystemBackend.virtual_mode 是两层独立机制。物理模式下需在此放行。

剥离说明：当 deepagents 原生支持文件工具直接读本机绝对路径时，删除本文件，并移除
__init__.install() 中对 install_validate_path_shim() 的调用（详见 PEEL_OFF.md）。
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence

from src.service.agent.path_access.host_paths import (
    is_host_absolute_path,
    normalize_host_path,
)

logger = logging.getLogger(__name__)

_installed = False
_orig_validate_path: Callable[..., str] | None = None


def _validate_path_allow_physical(
    path: str,
    *,
    allowed_prefixes: Sequence[str] | None = None,
) -> str:
    if is_host_absolute_path(path):
        return normalize_host_path(path)
    assert _orig_validate_path is not None
    return _orig_validate_path(path, allowed_prefixes=allowed_prefixes)


def install_validate_path_shim() -> None:
    """patch deepagents 三处 validate_path；重复调用安全。"""
    global _installed, _orig_validate_path
    if _installed:
        return

    from deepagents.backends import utils as backend_utils
    from deepagents.middleware import filesystem as fs_middleware

    from src.service.agent import compatible_filesystem_middleware as cfm

    _orig_validate_path = backend_utils.validate_path
    backend_utils.validate_path = _validate_path_allow_physical
    fs_middleware.validate_path = _validate_path_allow_physical
    cfm.validate_path = _validate_path_allow_physical
    logger.info(
        "Agent physical path mode: file tools accept host absolute paths "
        "(Windows drive / Unix absolute)"
    )
    _installed = True
