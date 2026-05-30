"""AGENT_VIRTUAL_MODE=0 时允许 read_file 等工具使用 Windows 绝对路径。"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Sequence

from src.core.config import is_agent_virtual_mode

logger = logging.getLogger(__name__)

_installed = False
_orig_validate_path: Callable[..., str] | None = None


def _validate_path_allow_physical(
    path: str,
    *,
    allowed_prefixes: Sequence[str] | None = None,
) -> str:
    if not is_agent_virtual_mode() and re.match(r"^[a-zA-Z]:", path):
        return path.replace("\\", "/")
    assert _orig_validate_path is not None
    return _orig_validate_path(path, allowed_prefixes=allowed_prefixes)


def install_agent_path_policy() -> None:
    global _installed, _orig_validate_path
    if _installed:
        return

    from deepagents.backends import utils as backend_utils
    from deepagents.middleware import filesystem as fs_middleware

    from src.service.agent import compatible_filesystem_middleware as cfm

    _orig_validate_path = backend_utils.validate_path

    if is_agent_virtual_mode():
        logger.info("Agent virtual path mode enabled")
        _installed = True
        return

    backend_utils.validate_path = _validate_path_allow_physical
    fs_middleware.validate_path = _validate_path_allow_physical
    cfm.validate_path = _validate_path_allow_physical
    logger.info(
        "Agent virtual path mode disabled: file tools accept Windows absolute paths"
    )
    _installed = True
