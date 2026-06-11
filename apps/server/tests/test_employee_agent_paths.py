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


def test_agent_constructs_with_real_paths():
    """构造 employee agent 不抛异常（pytest 环境 checkpointer 回退 MemorySaver）。
    验证 create_deep_agent 接受真实路径 skills/memory + shell_backend 作 backend。"""
    from src.service.agent.compatible_filesystem_middleware import (
        install_compatible_filesystem_middleware,
    )

    install_compatible_filesystem_middleware()
    agent = emp.get_agent(None, None, employee_id=None, conversation_id=None)
    assert agent is not None
