"""employee agent：backend 不再是 CompositeBackend 虚拟路由；技能可写。"""
import inspect

from src.service.agent import employee as emp


def test_no_composite_routes_in_source():
    src = inspect.getsource(emp.get_agent)
    assert '"/skills/"' not in src
    assert '"/artifacts/"' not in src
    assert "CompositeBackend" not in src


def test_no_skills_write_deny_in_source():
    src = inspect.getsource(emp.get_agent)
    assert '"/skills/**"' not in src


def test_skills_memory_use_real_paths():
    src = inspect.getsource(emp.get_agent)
    assert 'memory=["/agent/AGENTS.md"' not in src
    assert "skills=skill_sources" in src


def test_uses_workspace_dirs_and_injects_public():
    src = inspect.getsource(emp.get_agent)
    # 产物用员工工作空间解析（resolve_workspace_dirs），且把工作空间/公共区传给 shell
    assert "resolve_workspace_dirs(" in src
    assert "workspace_root=ws.workspace_dir" in src
    assert "public_dir=ws.public_dir" in src
    assert "public_root=ws.public_root" in src
    # 不再用旧的会话级 artifacts 直接拼接
    assert 'str(conversation_id) / "artifacts"' not in src


def test_agent_constructs_with_real_paths():
    """构造 employee agent 不抛异常（pytest 环境 checkpointer 回退 MemorySaver）。
    验证 create_deep_agent 接受真实路径 skills/memory + shell_backend 作 backend。"""
    from src.service.agent.compatible_filesystem_middleware import (
        install_compatible_filesystem_middleware,
    )

    install_compatible_filesystem_middleware()
    agent = emp.get_agent(None, None, employee_id=None, conversation_id=None)
    assert agent is not None
