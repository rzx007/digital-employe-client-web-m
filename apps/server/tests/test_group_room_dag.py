"""群协作流程 DAG 应聚合「本轮在执行的 task 全集」，而非只锚最新一份 plan。

复现场景：组长为同一个请求生成了多份编排计划——
- Plan A（先生成、id 较小）：2 个任务（两名员工），均已在执行（各自有 running 日志）；
- Plan B（后生成、id 较大）：1 个任务，尚未执行（无日志）。

当前 get_room_dag 只锚最新 plan（id desc 取首），于是只画出 Plan B 那 1 个 pending
worker 节点，把真正在跑的两个任务漏掉。目标行为：DAG 应聚合本轮在执行的任务全集，
画出 Plan A 的 2 个 running worker 节点。（本测试先红。）
"""

from __future__ import annotations

from src.models.conversation import Conversation
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from src.service.group_room_service import GroupRoomService
from src.service.group_service import GroupService
from tests.conftest import add_employee


def _add_plan(db, workspace_id: int, leader_conv_id: int) -> OrchestrationPlan:
    plan = OrchestrationPlan(
        workspace_id=workspace_id,
        conversation_id=leader_conv_id,
        user_input="同一个请求",
        plan_json="[]",
        status="confirmed",
        total_tasks=0,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def _add_task(db, workspace_id: int, employee_id: int, plan_id: int, name: str):
    task = EmployeeTask(
        workspace_id=workspace_id,
        employee_id=employee_id,
        employee_name_snapshot="员工",
        task_name=name,
        dispatch_type="skill",
        cron_expression="",
        cron_expression_type="custom",
        user_prompt="执行",
        execute_mode="immediate",
        source="orchestration",
        is_active=True,
        orchestration_plan_id=plan_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def _add_running_log(db, task, leader_conv_id: int):
    log = TaskExecutionLog(
        task_id=task.id,
        workspace_id=task.workspace_id,
        employee_id=task.employee_id,
        orchestrator_conversation_id=leader_conv_id,
        task_name_snapshot=task.task_name,
        run_status="running",
        started_at=cst_now(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def test_room_dag_aggregates_all_running_tasks_not_just_latest_plan(
    db_session, workspace
):
    emp_a = add_employee(db_session, workspace.id, name="员工A")
    emp_b = add_employee(db_session, workspace.id, name="员工B")
    emp_c = add_employee(db_session, workspace.id, name="员工C")

    group = GroupService.create_group(
        db_session, workspace.id, "测试群", [emp_a.id, emp_b.id, emp_c.id]
    )
    group_conv = Conversation(
        workspace_id=workspace.id,
        target_type="group",
        target_id=group.id,
        title="测试群",
    )
    db_session.add(group_conv)
    db_session.commit()
    db_session.refresh(group_conv)

    room = GroupRoomService.ensure_room(db_session, group_conv)
    leader_conv_id = room.leader_conversation_id
    assert leader_conv_id is not None

    # Plan A：先生成，两个任务都在执行（各有 running 日志）
    plan_a = _add_plan(db_session, workspace.id, leader_conv_id)
    task_a1 = _add_task(db_session, workspace.id, emp_a.id, plan_a.id, "任务A1")
    task_a2 = _add_task(db_session, workspace.id, emp_b.id, plan_a.id, "任务A2")
    _add_running_log(db_session, task_a1, leader_conv_id)
    _add_running_log(db_session, task_a2, leader_conv_id)

    # Plan B：后生成（id 更大），仅 1 个任务且未执行（无日志）
    plan_b = _add_plan(db_session, workspace.id, leader_conv_id)
    assert plan_b.id > plan_a.id
    _add_task(db_session, workspace.id, emp_c.id, plan_b.id, "任务B1")

    dag = GroupRoomService.get_room_dag(db_session, group_conv.id)
    worker_nodes = [n for n in dag["nodes"] if n["type"] == "worker"]

    # 应聚合 Plan A 两个在执行的任务，而非只画 Plan B 的 1 个
    assert len(worker_nodes) == 2
    assert all(n["state"] == "running" for n in worker_nodes)
