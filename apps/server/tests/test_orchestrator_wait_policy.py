"""编排派单：何时等待总管 astream 结束再启员工流。"""

from src.service.agent.orchestrator.execution import should_skip_orchestrator_wait


def test_initial_task_waits_for_orchestrator() -> None:
    """首轮派活（无前置简报）：不能跳过等总管流结束。"""
    assert should_skip_orchestrator_wait(prereq_briefing="") is False


def test_dependency_successor_may_skip_wait() -> None:
    assert should_skip_orchestrator_wait(prereq_briefing="【前置任务已完成】") is True


def test_whitespace_briefing_does_not_skip() -> None:
    assert should_skip_orchestrator_wait(prereq_briefing="   ") is False


def test_build_dispatch_extra_meta_orchestrator() -> None:
    from src.service.agent.orchestrator.execution import build_dispatch_extra_meta

    meta = build_dispatch_extra_meta(task_id=1)
    assert meta == {"dispatchedByOrchestrator": True, "sourceTaskId": 1}
    assert "dispatchedByGroupLeader" not in meta
