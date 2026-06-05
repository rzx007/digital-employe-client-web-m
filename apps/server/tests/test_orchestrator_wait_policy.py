"""编排派单：何时等待总管/组长 astream 结束再启员工流。"""

from src.service.agent.orchestrator.execution import should_skip_orchestrator_wait


def test_initial_group_task_waits_for_leader() -> None:
    """群房间首轮派活：有 shared 目录也不能跳过等组长流结束。"""
    assert should_skip_orchestrator_wait(prereq_briefing="") is False


def test_dependency_successor_may_skip_wait() -> None:
    assert should_skip_orchestrator_wait(prereq_briefing="【前置任务已完成】") is True


def test_whitespace_briefing_does_not_skip() -> None:
    assert should_skip_orchestrator_wait(prereq_briefing="   ") is False


def test_build_dispatch_extra_meta_group_leader() -> None:
    from src.service.agent.orchestrator.execution import build_dispatch_extra_meta

    curator = build_dispatch_extra_meta(task_id=1, is_group_leader=False)
    assert curator == {"dispatchedByOrchestrator": True, "sourceTaskId": 1}
    assert "dispatchedByGroupLeader" not in curator

    group = build_dispatch_extra_meta(task_id=2, is_group_leader=True)
    assert group["dispatchedByGroupLeader"] is True
