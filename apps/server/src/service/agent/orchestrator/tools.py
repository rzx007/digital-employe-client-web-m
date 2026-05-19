from __future__ import annotations

import json

from langchain_core.tools import tool
from sqlalchemy import select

from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.service.agent.orchestrator.execution import execute_plan
from src.service.agent.orchestrator.prompts import build_employee_capability_context
from src.service.agent.orchestrator.runtime import (
    get_conversation_id,
    get_db,
    get_workspace_id,
)


@tool
def list_workspace_employees() -> str:
    """列出当前工作空间所有数字员工及其角色、技能、MCP 外接能力。在拆解任务前必须先调用此工具。"""
    db = get_db()
    workspace_id = get_workspace_id()
    return build_employee_capability_context(db, workspace_id)


@tool
def create_orchestration_plan(summary: str, tasks: str) -> str:
    """创建任务编排计划。调用时机：确认任务拆解和员工分配无误后调用。

    参数:
      summary: 编排计划的中文描述
      tasks: JSON 数组字符串，每个元素格式:
        {{
          "employee_id": <int>,
          "task_name": "<任务名称>",
          "prompt": "<下发给该员工 Agent 的执行指令>",
          "dispatch_type": "skill",
          "skill_id": <int | null>,
          "cron": "<cron 表达式 | null>",
          "priority": <int>,
          "depends_on": <int | null>
        }}
    """
    db = get_db()
    workspace_id = get_workspace_id()
    conversation_id = get_conversation_id()

    if not conversation_id:
        return "错误：当前没有活跃的对话，无法创建编排计划。"

    try:
        task_list: list[dict] = json.loads(tasks)
    except json.JSONDecodeError as exc:
        return f"错误：tasks 参数格式不是合法的 JSON 数组: {exc}"

    if not isinstance(task_list, list) or len(task_list) == 0:
        return "错误：tasks 不能为空，至少需要一个子任务。"

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
    )
    db.add(plan)
    db.flush()

    for t in task_list:
        cron_expr = t.get("cron")
        task = EmployeeTask(
            workspace_id=workspace_id,
            employee_id=t["employee_id"],
            employee_name_snapshot=t.get("employee_name") or "",
            task_name=t["task_name"],
            dispatch_type=t.get("dispatch_type", "skill"),
            skill_id=t.get("skill_id"),
            cron_expression=cron_expr if cron_expr else "",
            cron_expression_type="custom",
            user_prompt=t.get("prompt", ""),
            execute_mode="scheduled" if cron_expr else "immediate",
            source="orchestration",
            orchestration_plan_id=plan.id,
            priority=t.get("priority", 0),
            is_active=True,
        )
        db.add(task)

    db.commit()

    from src.service.workspace_events import WorkspaceEventBus

    tasks_for_event: list[dict] = []
    for t in task_list:
        emp = db.get(Employee, t["employee_id"])
        tasks_for_event.append({
            "task_id": t.get("task_name", ""),
            "task_name": t.get("task_name", ""),
            "employee_name": emp.name if emp else "",
            "cron": t.get("cron"),
            "execute_mode": "scheduled" if t.get("cron") else "immediate",
        })
    WorkspaceEventBus.push(workspace_id, {
        "type": "orchestration_plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "tasks": tasks_for_event,
    })

    plan_json_output = json.dumps({
        "type": "plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "tasks": tasks_for_event,
    }, ensure_ascii=False)

    return plan_json_output + "\n\n" + f"编排计划 #{plan.id} 已生成，包含 {len(task_list)} 个子任务。\n请回复「确认」开始执行。记住：只有调用 confirm_orchestration_plan({plan.id}) 工具才能执行。"


@tool
def confirm_orchestration_plan(plan_id: int) -> str:
    """用户确认编排计划后调用，开始执行所有子任务。
    注意：此工具只有当用户明确说「确认」「开始执行」「没问题」「可以」等时才能调用。"""
    db = get_db()
    workspace_id = get_workspace_id()

    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"错误：编排计划 #{plan_id} 不存在。"

    if plan.status != "pending":
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法执行。"

    return execute_plan(db, plan, workspace_id)


@tool
def update_task(
    task_id: int,
    task_name: str | None = None,
    prompt: str | None = None,
    cron: str | None = None,
    employee_id: int | None = None,
) -> str:
    """修改已存在的子任务。参数均可选，只更新传入的非 None 字段。"""
    db = get_db()
    task = db.get(EmployeeTask, task_id)
    if not task:
        return f"错误：任务 #{task_id} 不存在。"

    changed: list[str] = []
    if task_name is not None:
        task.task_name = task_name
        changed.append("任务名称")
    if prompt is not None:
        task.user_prompt = prompt
        changed.append("执行指令")
    if cron is not None:
        task.cron_expression = cron if cron else ""
        task.execute_mode = "scheduled" if cron else "immediate"
        changed.append("调度时间")
    if employee_id is not None:
        emp = db.get(Employee, employee_id)
        if not emp:
            return f"错误：员工 ID={employee_id} 不存在。"
        task.employee_id = employee_id
        task.employee_name_snapshot = emp.name or ""
        changed.append("执行员工")

    if changed:
        db.commit()
        if "调度时间" in changed:
            from src.service.task_scheduler_service import TaskSchedulerService

            TaskSchedulerService.reload_jobs()
        return f"任务 #{task_id} ({task.task_name}) 已更新：{'、'.join(changed)}。"
    return "未做任何修改。"


@tool
def delete_task(task_id: int) -> str:
    """删除子任务（物理删除，关联的执行记录会保留但 task_id 置空）。"""
    db = get_db()
    task = db.get(EmployeeTask, task_id)
    if not task:
        return f"错误：任务 #{task_id} 不存在。"

    db.delete(task)
    db.commit()
    from src.service.task_scheduler_service import TaskSchedulerService

    TaskSchedulerService.reload_jobs()
    return f"任务 #{task_id} ({task.task_name}) 已删除。"


@tool
def cancel_plan(plan_id: int) -> str:
    """取消整个编排计划（设置 status=cancelled）。"""
    db = get_db()
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"错误：编排计划 #{plan_id} 不存在。"

    if plan.status not in ("pending", "confirmed"):
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法取消。"

    plan.status = "cancelled"
    db.commit()
    return f"编排计划 #{plan_id} 已取消。"


@tool
def list_tasks(
    status: str | None = None,
    plan_id: int | None = None,
    employee_id: int | None = None,
    limit: int = 20,
) -> str:
    """查询任务列表。查询当前工作空间下的 EmployeeTask。"""
    db = get_db()
    workspace_id = get_workspace_id()

    query = select(EmployeeTask).where(
        EmployeeTask.workspace_id == workspace_id,
        EmployeeTask.is_active.is_(True),
    )

    if plan_id is not None:
        query = query.where(EmployeeTask.orchestration_plan_id == plan_id)
    if employee_id is not None:
        query = query.where(EmployeeTask.employee_id == employee_id)
    if status is not None:
        from src.models.task_execution_log import TaskExecutionLog

        if status in ("executing",):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "running"
            ).distinct()
            query = query.where(
                (EmployeeTask.execute_mode == "scheduled")
                | (EmployeeTask.id.in_(sub))
            )
        elif status in ("completed", "success"):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "success"
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status in ("failed", "timeout", "cancelled"):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status.in_(["failed", "timeout", "cancelled"])
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status == "pending":
            query = query.where(
                EmployeeTask.execute_mode == "scheduled",
                ~EmployeeTask.id.in_(
                    select(TaskExecutionLog.task_id).distinct()
                ),
            )

    tasks = list(
        db.scalars(
            query.order_by(EmployeeTask.priority.desc(), EmployeeTask.id.desc()).limit(limit)
        ).all()
    )

    if not tasks:
        return "没有找到匹配的任务。"

    lines = ["| ID | 任务名 | 员工 | 执行模式 | 状态 |", "|---|---|---|---|---|"]
    from src.models.task_execution_log import TaskExecutionLog

    for t in tasks:
        emp = db.get(Employee, t.employee_id)
        emp_name = emp.name if emp else (t.employee_name_snapshot or str(t.employee_id))
        mode = "定时" if t.execute_mode == "scheduled" else "即时"
        latest_log = db.scalars(
            select(TaskExecutionLog.run_status).where(
                TaskExecutionLog.task_id == t.id
            ).order_by(TaskExecutionLog.id.desc()).limit(1)
        ).first()
        task_status = latest_log or (
            "运行中" if t.execute_mode == "scheduled" else "未执行"
        )
        lines.append(f"| {t.id} | {t.task_name} | {emp_name} | {mode} | {task_status} |")

    return "\n".join(lines)
