"""save_to_resource_pool 工具：把当前会话的 .html 产物登记进资源池 DB 表。"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.service.agent.tools.workbench import resolve_resource_pool_src_path


def test_resolve_src_path_relative_to_root():
    root = "C:/data/ws"
    abs_path = "C:/data/ws/employee-69/artifacts/sales.html"
    rel = resolve_resource_pool_src_path(root, abs_path)
    assert rel == "employee-69/artifacts/sales.html"


def test_resolve_src_path_posix_backslash():
    root = r"C:\data\ws"
    abs_path = r"C:\data\ws\employee-69\artifacts\sales.html"
    rel = resolve_resource_pool_src_path(root, abs_path)
    assert rel == "employee-69/artifacts/sales.html"


def test_resolve_src_path_outside_root_returns_none():
    root = "C:/data/ws"
    abs_path = "C:/other/x.html"
    assert resolve_resource_pool_src_path(root, abs_path) is None
