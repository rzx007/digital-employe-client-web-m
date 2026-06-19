"""编排计划工具：创建 / 确认 / 取消。"""

from __future__ import annotations

import json

from langchain_core.tools import tool
from sqlalchemy import select

from src.models.conversation import ConversationMessage
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.service.agent.orchestrator.confirmation_policy import (
    compute_requires_confirmation,
)
from src.service.agent.orchestrator.execution import execute_plan
from src.service.agent.orchestrator.runtime import (
    get_conversation_id,
    get_db,
    get_workspace_id,
    invalidate_orchestrator_db_cache,
)
from src.service.agent.orchestrator.task_validation import validate_orchestration_tasks
from src.service.agent.orchestrator.tools._helpers import (
    parse_orchestration_task_list,
)


def _build_employee_task(
    db, t: dict, plan_id: int, workspace_id: int, conversation_id: int
) -> EmployeeTask:
    """从单个任务 dict 构造一条 EmployeeTask（首建/合并两条路径共用，杜绝字段漂移）。

    输出档位（small/standard/large）存入 task_input_json，派单时取出设成该成员模型的
    max_tokens（见 start_task_as_conversation）。
    """
    cron_expr = t.get("cron")
    emp = db.get(Employee, t["employee_id"])
    return EmployeeTask(
        workspace_id=workspace_id,
        employee_id=t["employee_id"],
        employee_name_snapshot=emp.name if emp else "",
        task_name=t["task_name"],
        dispatch_type=t.get("dispatch_type", "skill"),
        skill_id=t.get("skill_id"),
        cron_expression=cron_expr if cron_expr else "",
        cron_expression_type="custom",
        user_prompt=t.get("prompt", ""),
        task_input_json=json.dumps(
            {"output_tier": (t.get("output_tier") or "standard")},
            ensure_ascii=False,
        ),
        execute_mode="scheduled" if cron_expr else "immediate",
        source="orchestration",
        orchestration_plan_id=plan_id,
        source_conversation_id=conversation_id,
        priority=t.get("priority", 0),
        is_active=True,
    )


@tool
def create_orchestration_plan(summary: str, tasks: str | list) -> str:
    """创建任务编排计划。调用时机：确认任务拆解和员工分配无误后调用。

    注意：禁止将同一 employee_id 拆成多条子任务；单员工多步须合并为一条 prompt。

    参数:
      summary: 编排计划的中文描述
      tasks: JSON 数组字符串，或直接传数组；每个元素格式:
        {
          "employee_id": <int>,
          "task_name": "<任务名称>",
          "prompt": "<下发给该员工 Agent 的执行指令>",
          "dispatch_type": "skill",
          "skill_id": <int | null>,
          "cron": "<cron 表达式 | null>",
          "priority": <int>,
          "depends_on": <int | int[] | null>,
          "output_tier": "<small | standard | large>"
        }
      output_tier：该子任务**预期输出体量**，决定该成员单次最多生成多少 token：
        - "small"   ≈1k：取数/查询/一句话结论等极短产出；
        - "standard"≈16k：一般任务（默认，可省略）；
        - "large"   ≈64k：长文档/完整报告（Word/PPT/PDF 专员写整篇）。
        按任务实际需要选；选小可让该成员更快产出、尽早释放算力。
      depends_on：该子任务依赖的前置任务下标（数组中第几个，从 0 开始）。
        - null/省略：无依赖，确认后立即并行执行；
        - 单个 int：等该前置任务**完成后**才开始（真·串行）；
        - int[]：等列出的多个前置全部完成后才开始（多依赖汇合）。
        依赖任务只有在前置真正产出结果后才会被派发，前置产物会自动作为简报引用注入。
      cron：标准 5 段「分 时 日 月 周」。"30 9 * * *"=每天 9:30；"*/10 * * * *"=每 10 分钟重复。
        标准 cron **无法表达"仅一次"**（"33 14 * * *" 会每天重复）；只跑一次用 cron=null（confirm 后立即执行）。
    """
    db = get_db()
    workspace_id = get_workspace_id()
    conversation_id = get_conversation_id()

    if not conversation_id:
        return "错误：当前没有活跃的对话，无法创建编排计划。"

    task_list, parse_error = parse_orchestration_task_list(tasks)
    if parse_error:
        return parse_error
    assert task_list is not None

    validation_error = validate_orchestration_tasks(task_list)
    if validation_error:
        return validation_error

    for i, t in enumerate(task_list):
        emp = db.get(Employee, t.get("employee_id"))
        if not emp:
            return f"错误：子任务 #{i} 指定的员工 ID={t.get('employee_id')} 不存在。"

    # 幂等闸：同会话已有 pending 计划时，静默合并而非拒绝（confirmed/cancelled 不拦）。
    existing = db.scalars(
        select(OrchestrationPlan)
        .where(
            OrchestrationPlan.conversation_id == conversation_id,
            OrchestrationPlan.status == "pending",
        )
        .order_by(OrchestrationPlan.id.desc())
    ).first()
    if existing is not None:
        # 静默合并：把本次 tasks 中「员工+任务名」不与已有计划重复的条目追加进去。
        # 不报错、不诱导 cancel——杜绝组长取消正确计划重建残缺的回归。
        existing_keys = {
            (t.employee_id, t.task_name)
            for t in db.scalars(
                select(EmployeeTask).where(
                    EmployeeTask.orchestration_plan_id == existing.id
                )
            ).all()
        }
        existing_plan_json = json.loads(existing.plan_json or "[]")
        appended: list[EmployeeTask] = []
        for t in task_list:
            key = (t["employee_id"], t["task_name"])
            if key in existing_keys:
                continue
            existing_keys.add(key)
            new_task = _build_employee_task(
                db, t, existing.id, workspace_id, conversation_id
            )
            db.add(new_task)
            appended.append(new_task)
            merged_entry = dict(t)
            merged_entry.pop("depends_on", None)
            existing_plan_json.append(merged_entry)

        # 本次任务均已在计划中：不重写 plan_json、不提交、不空推事件，直接返回现状。
        if not appended:
            return (
                f"计划 #{existing.id} 已是最新（本次任务均已在计划中），现含 "
                f"{existing.total_tasks} 个子任务。无需重复创建，请告知用户在卡片确认。"
            )

        existing.plan_json = json.dumps(existing_plan_json, ensure_ascii=False)
        existing.total_tasks = len(existing_plan_json)
        db.add(existing)
        db.commit()
        for nt in appended:
            db.refresh(nt)
        db.refresh(existing)

        from src.service.workspace_events import WorkspaceEventBus

        all_tasks = db.scalars(
            select(EmployeeTask)
            .where(EmployeeTask.orchestration_plan_id == existing.id)
            .order_by(EmployeeTask.id.asc())
        ).all()
        merged_requires_confirmation = compute_requires_confirmation(
            json.loads(existing.plan_json or "[]")
        )
        tasks_for_event = [
            {
                "task_id": tk.id,
                "task_name": tk.task_name,
                "employee_id": tk.employee_id,
                "employee_name": tk.employee_name_snapshot or "",
                "cron": tk.cron_expression or None,
                "execute_mode": tk.execute_mode,
            }
            for tk in all_tasks
        ]
        WorkspaceEventBus.push(workspace_id, {
            "type": "orchestration_plan_generated",
            "plan_id": existing.id,
            "summary": existing.user_input or summary,
            "total_tasks": existing.total_tasks,
            "requires_confirmation": merged_requires_confirmation,
            "tasks": tasks_for_event,
        })
        plan_json_output = json.dumps({
            "type": "plan_generated",
            "plan_id": existing.id,
            "summary": existing.user_input or summary,
            "total_tasks": existing.total_tasks,
            "requires_confirmation": merged_requires_confirmation,
            "tasks": tasks_for_event,
        }, ensure_ascii=False)
        return (
            plan_json_output
            + "\n\n"
            + f"已并入计划 #{existing.id}，现含 {existing.total_tasks} 个子任务。"
            f"如需调整任务用 update_task；无需重新创建，请告知用户在卡片确认。"
        )

    # message_id：绑定到本会话最近一条 assistant 消息（总管上下文不暴露当前消息 id，
    # 故按 id 倒序取最新 assistant 消息；无则留 None）。
    latest_assistant = db.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation_id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()

    plan = OrchestrationPlan(
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        message_id=(latest_assistant.id if latest_assistant else None),
        user_input=summary,
        plan_json=json.dumps(task_list, ensure_ascii=False),
        status="pending",
        total_tasks=len(task_list),
    )
    db.add(plan)
    db.flush()

    created_tasks: list[EmployeeTask] = []
    for t in task_list:
        task = _build_employee_task(
            db, t, plan.id, workspace_id, conversation_id
        )
        db.add(task)
        created_tasks.append(task)

    db.commit()
    for task in created_tasks:
        db.refresh(task)

    from src.service.workspace_events import WorkspaceEventBus

    requires_confirmation = compute_requires_confirmation(task_list)

    tasks_for_event: list[dict] = []
    for task in created_tasks:
        tasks_for_event.append({
            "task_id": task.id,
            "task_name": task.task_name,
            "employee_id": task.employee_id,
            "employee_name": task.employee_name_snapshot or "",
            "cron": task.cron_expression or None,
            "execute_mode": task.execute_mode,
        })
    WorkspaceEventBus.push(workspace_id, {
        "type": "orchestration_plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "requires_confirmation": requires_confirmation,
        "tasks": tasks_for_event,
    })

    plan_json_output = json.dumps({
        "type": "plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "requires_confirmation": requires_confirmation,
        "tasks": tasks_for_event,
    }, ensure_ascii=False)

    return (
        plan_json_output
        + "\n\n"
        + f"编排计划 #{plan.id} 已生成，包含 {len(task_list)} 个子任务。\n"
        f"requires_confirmation={str(requires_confirmation).lower()}；"
        f"须等用户在卡片上确认或明确回复后再调用 confirm_orchestration_plan({plan.id})。\n"
        f"tasks[].task_id 为 employee_tasks 主键；plan_id={plan.id} 不可用于 "
        "delete_task/update_task。执行只能通过 confirm_orchestration_plan 工具生效。"
    )


@tool
def confirm_orchestration_plan(plan_id: int) -> str:
    """启动编排计划下所有子任务（各员工在独立会话执行）。

    须用户通过卡片确认或明确文字确认后再调用；禁止在 create 后同一轮自动调用。
    调用后：向用户简短说明委派即可；禁止轮询 list_tasks，禁止代员工 shell/read 技能。
    """
    db = get_db()
    workspace_id = get_workspace_id()

    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"错误：编排计划 #{plan_id} 不存在。"

    if plan.status != "pending":
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法执行。"

    # 硬闸：群组长会话且该群未开启「自动确认」时，**拒绝**自动执行——执行必须由
    # 用户点击群里的「确认执行」卡片驱动。软 prompt 治不住模型擅自 confirm，故在
    # 工具层硬拦，杜绝「没问用户就执行」。开关开时照常执行。
    if _is_group_leader_plan_pending_user_confirm(db, plan):
        return (
            f"⛔ 该群未开启「自动确认」，编排计划 #{plan_id} **不能由你自动执行**。"
            "计划已以「确认执行」卡片呈现给用户，请**结束本轮、停下等用户点击确认**，"
            "不要再调用 confirm_orchestration_plan。"
        )

    return execute_plan(db, plan, workspace_id)


def _is_group_leader_plan_pending_user_confirm(db, plan) -> bool:
    """该计划是否属于「未开自动确认的群组长会话」→ 须等用户点卡片确认，禁止工具自动执行。"""
    from src.models.group_room import GroupRoom

    conv_id = plan.conversation_id
    if conv_id is None:
        return False
    room = db.scalars(
        select(GroupRoom).where(GroupRoom.leader_conversation_id == conv_id)
    ).first()
    if room is None:
        return False  # 不是群组长计划（普通总管走真人 HITL 卡片），不拦
    return not bool(getattr(room, "auto_confirm_member_tasks", False))


@tool
def cancel_plan(plan_id: int) -> str:
    """取消整个编排计划（停用子任务、终止进行中执行、刷新调度）。"""
    db = get_db()
    from src.service.orchestration_lifecycle import cancel_orchestration_plan

    err = cancel_orchestration_plan(db, plan_id)
    if err:
        return f"错误：{err}"
    invalidate_orchestrator_db_cache()
    return f"编排计划 #{plan_id} 已取消。"
