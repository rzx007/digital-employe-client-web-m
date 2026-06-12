"""删 shim 后：放行本机绝对路径的逻辑由 install_compatible_filesystem_middleware 承担。"""
import pytest
from deepagents.middleware import filesystem as fsm
from deepagents.backends import utils as bu

from src.service.agent.compatible_filesystem_middleware import (
    install_compatible_filesystem_middleware,
)


def setup_module(_):
    install_compatible_filesystem_middleware()  # 幂等


def test_windows_absolute_allowed():
    # 工具实际调用点（运行时为 validate_path，无下划线 — spike 确认）
    assert fsm.validate_path(r"D:\space\foo.txt") == "D:/space/foo.txt"


def test_unix_absolute_allowed():
    assert fsm.validate_path("/home/u/x.md") == "/home/u/x.md"


def test_backend_utils_absolute_allowed():
    assert bu.validate_path(r"D:\ws\a.txt") == "D:/ws/a.txt"


def test_traversal_still_rejected():
    with pytest.raises(ValueError):
        fsm.validate_path("../etc/passwd")


def test_relative_path_passthrough():
    # 非绝对路径沿用 deepagents 原校验（归一化为 / 开头）
    assert fsm.validate_path("/workspace/a.txt") == "/workspace/a.txt"
