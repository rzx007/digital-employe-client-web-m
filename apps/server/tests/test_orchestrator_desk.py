from pathlib import Path
from src.service.agent.workspace_paths import (
    resolve_orchestrator_desk_dir,
    orchestrator_task_subdir,
    resolve_workspace_dirs,
)


def test_dispatched_employee_shares_desk(tmp_path):
    """被派员工：写桌的 task 子目录、读整张桌。"""
    orch_conv_id = 9
    task_id = 100
    desk = resolve_orchestrator_desk_dir(str(tmp_path), orch_conv_id)
    sub = orchestrator_task_subdir(desk, task_id)
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,                 # 成员执行会话
        shared_artifacts_dir=str(sub),
        shared_workspace_root=desk,
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == desk / "task-100"
    assert d.workspace_dir == desk
