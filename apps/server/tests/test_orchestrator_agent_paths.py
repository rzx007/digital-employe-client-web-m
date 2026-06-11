"""orchestrator agent：backend 不再是 CompositeBackend 虚拟路由；技能可写。"""
import inspect

from src.service.agent.orchestrator import agent as orch


def test_orch_no_composite_routes():
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert "CompositeBackend" not in src
    assert '"/skills/"' not in src
    assert '"/artifacts/"' not in src


def test_orch_skills_memory_real_paths():
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert 'memory=["/agent/AGENTS.md"' not in src
    assert 'skills=["/skills/"]' not in src
