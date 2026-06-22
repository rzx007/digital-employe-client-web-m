"""编排计划工具：创建 / 确认 / 取消。"""

from __future__ import annotations

import json

from langchain_core.tools import tool

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
from src.service.task_scheduler_service import parse_nl_cron


@tool
def create_orchestration_plan(summary: str, tasks: str | list, schedule: str | None = None) -> str:
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
      schedule: 计划级重复节拍（可选）。标准 5 段 cron（"0 10 * * *"）或自然语言
        （"每天 10 点"、"每周一上午 9:30"）均可。设置后整个计划在每个节拍自动
        重跑冻结 DAG，绝不重新分析分单；子任务不再携带独立 cron。
        不传或传 null → 一次性计划（confirm 后立即执行）。
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
      cron：（子任务级，schedule 未设时有效）标准 5 段「分 时 日 月 周」。"30 9 * * *"=每天 9:30；
        "*/10 * * * *"=每 10 分钟重复。
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

    # 解析计划级 cron（自然语言 or 标准 cron）
    plan_cron = parse_nl_cron(schedule) if schedule else None

    if schedule and not plan_cron:
        return (
            f"错误：无法解析定时表达式「{schedule}」。请改用标准 5 段 cron"
            f"（如「0 10 * * *」表示每天 10:00），或换一种更明确的时间说法。"
        )

    for i, t in enumerate(task_list):
        emp = db.get(Employee, t.get("employee_id"))
        if not emp:
            return f"错误：子任务 #{i} 指定的员工 ID={t.get('employee_id')} 不存在。"

    plan = OrchestrationPlan(
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        user_input=summary,
        plan_json=json.dumps(task_list, ensure_ascii=False),
        status="pending",
        total_tasks=len(task_list),
        cron=plan_cron,
        is_recurring=bool(plan_cron),
    )
    db.add(plan)
    db.flush()

    created_tasks: list[EmployeeTask] = []
    for t in task_list:
        cron_expr = t.get("cron")
        emp = db.get(Employee, t["employee_id"])
        # 计划级 cron 存在时：子任务不携带独立 cron，强制 immediate（由 run_plan_job 驱动）
        if plan_cron:
            task_cron_expression = ""
            task_execute_mode = "immediate"
        else:
            task_cron_expression = cron_expr if cron_expr else ""
            task_execute_mode = "scheduled" if cron_expr else "immediate"
        task = EmployeeTask(
            workspace_id=workspace_id,
            employee_id=t["employee_id"],
            employee_name_snapshot=emp.name if emp else "",
            task_name=t["task_name"],
            dispatch_type=t.get("dispatch_type", "skill"),
            skill_id=t.get("skill_id"),
            cron_expression=task_cron_expression,
            cron_expression_type="custom",
            user_prompt=t.get("prompt", ""),
            # 输出档位（small/standard/large）存入 task_input_json，派单时取出设成
            # 该成员模型的 max_tokens（见 start_task_as_conversation）。
            task_input_json=json.dumps(
                {"output_tier": (t.get("output_tier") or "standard")},
                ensure_ascii=False,
            ),
            execute_mode=task_execute_mode,
            source="orchestration",
            orchestration_plan_id=plan.id,
            source_conversation_id=conversation_id,
            priority=t.get("priority", 0),
            is_active=True,
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

    # 低风险单任务（只读/查询类）免确认：直接自动执行，不再等用户确认。
    # 前端卡片不消费 requires_confirmation，故免确认必须在服务端落地为自动 execute_plan；
    # 执行后计划状态离开 pending，卡片自然不再显示「确认执行」按钮、改显进度。
    if not requires_confirmation:
        exec_result = execute_plan(db, plan, workspace_id)
        return (
            plan_json_output
            + "\n\n"
            + f"编排计划 #{plan.id}（{len(task_list)} 个子任务，低风险只读单任务）"
            "已**自动执行**，无需用户确认、**不要**再调用 confirm_orchestration_plan。\n"
            + exec_result
            + "\n按「进度汇报骨架」给计数+状态清单后结束本轮。"
        )

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

    return execute_plan(db, plan, workspace_id)


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
