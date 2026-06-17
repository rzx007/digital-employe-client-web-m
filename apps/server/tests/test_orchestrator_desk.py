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


def test_orchestrator_uses_desk_root(tmp_path):
    """总管自己：artifacts 与 workspace 都指向桌根（与被派员工同桌）。"""
    desk = resolve_orchestrator_desk_dir(str(tmp_path), 9)
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id="orchestrator",
        conversation_id=9,
        shared_artifacts_dir=str(desk),       # 总管写桌根
        shared_workspace_root=desk,           # 总管读桌根
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == desk
    assert d.workspace_dir == desk

# NOTE(SP2 Task 2.1): 原 test_read_roots_include_orchestrator_desk 依赖
# resource_service._read_roots_with_desk —— 该 legacy/desk-merge 读回退已随
# spec §2「不做双轨读回退」删除。总管/desk 产物的项目根落点与面板可见性归
# Task 2.3，届时另补测试。
