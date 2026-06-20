"""验证 get_orchestrator_agent 已接入 write 守卫——与员工对称。

运行时注册路径依赖 build_chat_model / create_deep_agent（需 LLM 配置和文件系统），
在 CI 纯单测环境构造成本过高，故改用两层验证：
1. 源码断言：确认 register_write_guard / build_request_external_dir_tool /
   collect_workspace_roots 已出现在 get_orchestrator_agent 函数体，且条件与员工对称。
2. 注册表纯逻辑验证：直接调 register_write_guard + lookup_write_guard，
   确认注册表本身（无 agent 依赖）工作正常。
若后续有可用的完整 orchestrator agent fixture，可在此追加运行时集成测试。
"""

from __future__ import annotations

import inspect
from pathlib import Path

from src.service.agent.orchestrator import agent as orch
from src.service.agent.write_guard_registry import (
    lookup_write_guard,
    register_write_guard,
    clear_write_guard,
)


# ---------------------------------------------------------------------------
# 1. 源码断言：接线已存在
# ---------------------------------------------------------------------------


def test_orchestrator_imports_write_guard_symbols():
    """orchestrator/agent.py 已 import 三个写守卫符号。"""
    src = inspect.getsource(orch)
    assert "register_write_guard" in src
    assert "collect_workspace_roots" in src
    assert "build_request_external_dir_tool" in src


def test_orchestrator_register_write_guard_in_get_agent():
    """get_orchestrator_agent 函数体内含 register_write_guard 调用。"""
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert "register_write_guard(" in src


def test_orchestrator_write_guard_uses_artifacts_path():
    """写守卫根路径使用 artifacts_path（与员工用 root_path 语义对称）。"""
    src = inspect.getsource(orch.get_orchestrator_agent)
    # 关键：collect_workspace_roots 的第一个参数必须是 artifacts_path
    assert "collect_workspace_roots(" in src
    assert "str(artifacts_path)" in src


def test_orchestrator_appends_request_external_dir_tool():
    """总管 tools 列表已追加 build_request_external_dir_tool()。"""
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert "build_request_external_dir_tool()" in src
    assert "orchestrator_tools.append(" in src


def test_orchestrator_write_guard_condition_symmetric_with_employee():
    """write 守卫条件与员工完全对称：enable_hitl and conversation_id is not None
    and workspace_id is not None。"""
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert (
        "enable_hitl and conversation_id is not None and workspace_id is not None"
        in src
    )


def test_orchestrator_system_prompt_appended_with_external_dir_hint():
    """system_prompt 已追加工作区外写盘须申请授权的提示（与员工原文一致）。"""
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert "写工作区外目录前必须先调用 request_external_dir_access" in src
    assert "未获授权时 write_file 会被拒绝" in src


# ---------------------------------------------------------------------------
# 2. 注册表纯逻辑验证（无 agent 依赖）
# ---------------------------------------------------------------------------


def test_register_then_lookup_returns_non_none():
    """register_write_guard 后 lookup_write_guard 返回非 None（注册表自身可用）。"""
    cid = 99901
    try:
        register_write_guard(
            cid,
            roots=[Path("/tmp/test-root")],
            workspace_id=42,
        )
        result = lookup_write_guard(cid)
        assert result is not None
        assert result.workspace_id == 42
        assert any(str(r).endswith("test-root") for r in result.roots)
    finally:
        clear_write_guard(cid)


def test_lookup_unregistered_returns_none():
    """未注册的 conversation_id 查询返回 None（fail-open 逻辑前提）。"""
    assert lookup_write_guard(99902) is None
