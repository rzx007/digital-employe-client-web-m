"""群协作流程 DAG 应聚合「本轮在执行的 task 全集」，而非只锚最新一份 plan。

复现场景：组长为同一个请求生成了多份编排计划——
- Plan A（先生成、id 较小）：2 个任务（两名员工），均已在执行（各自有 running 日志）；
- Plan B（后生成、id 较大）：1 个任务，尚未执行（无日志）。

当前 get_room_dag 只锚最新 plan（id desc 取首），于是只画出 Plan B 那 1 个 pending
worker 节点，把真正在跑的两个任务漏掉。目标行为：DAG 应聚合本轮在执行的任务全集，
画出 Plan A 的 2 个 running worker 节点。（本测试先红。）
"""

from __future__ import annotations

import json

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


def _add_queued_log(db, task, leader_conv_id: int):
    log = TaskExecutionLog(
        task_id=task.id,
        workspace_id=task.workspace_id,
        employee_id=task.employee_id,
        orchestrator_conversation_id=leader_conv_id,
        task_name_snapshot=task.task_name,
        run_status="queued",
        started_at=cst_now(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def test_room_dag_dependency_edge_uses_full_plan_during_partial_execution(
    db_session, workspace
):
    """部分执行时，依赖边应基于「整 plan 的任务」按位置算，而非只用在执行子集。

    plan_json 按下标位置写 depends_on（element[i].depends_on 指向数组里第几个）。
    build_dependency_maps 把 tasks[i] 与 plan_json[i] 按位置对应、并以 idx（bounded
    by len(tasks)）解 depends_on。若只把「在执行子集」配上完整 plan_json，下标会错位
    →依赖边丢失/错连。

    构造能暴露 bug 的「严格子集」场景（3 任务一计划）：
      - plan_json index: 0=t0(前置)  1=t1(中间)  2=t2(末端, depends_on=1)
      - 仅 t1、t2 在执行（t0 尚未开始，不在聚合渲染集里）。
    用 subset=[t1,t2] 配完整 plan_json 时：positionally tasks[0]=t1↔plan_json[0]
    (无 dep)、tasks[1]=t2↔plan_json[1] (无 dep)，t2 真正的 depends_on（在
    plan_json[2]）永不读取 → 边 t1->t2 丢失。用整 plan [t0,t1,t2] 算则正确：
    plan_json[2].depends_on=1 → t2 依赖 t1 → 产出边 task-<t1> -> task-<t2>。
    """
    emp_a = add_employee(db_session, workspace.id, name="员工甲")
    emp_b = add_employee(db_session, workspace.id, name="员工乙")
    emp_c = add_employee(db_session, workspace.id, name="员工丙")

    group = GroupService.create_group(
        db_session, workspace.id, "依赖群", [emp_a.id, emp_b.id, emp_c.id]
    )
    group_conv = Conversation(
        workspace_id=workspace.id,
        target_type="group",
        target_id=group.id,
        title="依赖群",
    )
    db_session.add(group_conv)
    db_session.commit()
    db_session.refresh(group_conv)

    room = GroupRoomService.ensure_room(db_session, group_conv)
    leader_conv_id = room.leader_conversation_id
    assert leader_conv_id is not None

    plan = _add_plan(db_session, workspace.id, leader_conv_id)
    # 按 plan_json 顺序插入（id 升序 == plan_json 下标顺序）
    task0 = _add_task(db_session, workspace.id, emp_a.id, plan.id, "前置任务")
    task1 = _add_task(db_session, workspace.id, emp_b.id, plan.id, "中间任务")
    task2 = _add_task(db_session, workspace.id, emp_c.id, plan.id, "末端任务")
    assert task0.id < task1.id < task2.id

    # plan_json：index 2（末端任务）depends_on index 1（中间任务）。
    plan.plan_json = json.dumps(
        [
            {"task_name": "前置任务"},
            {"task_name": "中间任务"},
            {"task_name": "末端任务", "depends_on": 1},
        ],
        ensure_ascii=False,
    )
    db_session.commit()

    # 严格子集 + 部分执行：t0 未开始（无日志、不渲染），t1 running、t2 queued。
    _add_running_log(db_session, task1, leader_conv_id)
    _add_queued_log(db_session, task2, leader_conv_id)

    dag = GroupRoomService.get_room_dag(db_session, group_conv.id)
    edges = dag["edges"]
    worker_ids = {n["id"] for n in dag["nodes"] if n["type"] == "worker"}

    # 只渲染在执行的 t1、t2（t0 无日志不在聚合集）
    assert worker_ids == {f"task-{task1.id}", f"task-{task2.id}"}
    # 依赖边 task-<t1> -> task-<t2> 必须存在（证明用整 plan 位置算出了边；
    # 若用子集 [t1,t2] 算，下标错位会丢掉这条边——这是回归断言）
    assert {"from": f"task-{task1.id}", "to": f"task-{task2.id}"} in edges
    # t2 有依赖 → 不应从 leader 直连（不是根节点）
    assert {"from": "leader", "to": f"task-{task2.id}"} not in edges


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


def test_room_dag_aggregates_running_tasks_across_two_plans(db_session, workspace):
    """两份不同 plan 各有一个在执行的任务时，应跨 plan 聚合并都渲染成 running。

    验证 dep_map.update 的跨计划合并（不同 plan 的 task.id 互不冲突）以及
    两份计划的在执行任务都进入聚合渲染集。primary_plan_id 取 Counter.most_common
    首项；本场景两 plan 各 1 个任务（平票），只断言落在 {planA.id, planB.id}。
    """
    emp_a = add_employee(db_session, workspace.id, name="员工甲2")
    emp_b = add_employee(db_session, workspace.id, name="员工乙2")

    group = GroupService.create_group(
        db_session, workspace.id, "双计划群", [emp_a.id, emp_b.id]
    )
    group_conv = Conversation(
        workspace_id=workspace.id,
        target_type="group",
        target_id=group.id,
        title="双计划群",
    )
    db_session.add(group_conv)
    db_session.commit()
    db_session.refresh(group_conv)

    room = GroupRoomService.ensure_room(db_session, group_conv)
    leader_conv_id = room.leader_conversation_id
    assert leader_conv_id is not None

    # Plan A：1 个任务，在执行
    plan_a = _add_plan(db_session, workspace.id, leader_conv_id)
    task_a = _add_task(db_session, workspace.id, emp_a.id, plan_a.id, "任务A")
    _add_running_log(db_session, task_a, leader_conv_id)

    # Plan B：另一份计划，1 个任务，也在执行
    plan_b = _add_plan(db_session, workspace.id, leader_conv_id)
    task_b = _add_task(db_session, workspace.id, emp_b.id, plan_b.id, "任务B")
    _add_running_log(db_session, task_b, leader_conv_id)

    dag = GroupRoomService.get_room_dag(db_session, group_conv.id)
    worker_nodes = [n for n in dag["nodes"] if n["type"] == "worker"]

    # 跨两份计划聚合：两个在执行的任务都应渲染且 running
    assert len(worker_nodes) == 2
    assert all(n["state"] == "running" for n in worker_nodes)
    worker_ids = {n["id"] for n in worker_nodes}
    assert worker_ids == {f"task-{task_a.id}", f"task-{task_b.id}"}
    # 平票时 most_common 任取其一，断言落在两 plan 之内
    assert dag["plan_id"] in {plan_a.id, plan_b.id}
