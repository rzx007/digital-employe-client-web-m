from __future__ import annotations

import json
from typing import Any

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
    invalidate_orchestrator_db_cache,
)
from src.service.agent.orchestrator.task_mutations import (
    MAX_TASK_DELETE_BATCH,
    _delete_task_with_fresh_session,
    _update_task_with_fresh_session,
    delete_tasks_batch as run_delete_tasks_batch,
)


def parse_orchestration_task_list(tasks: Any) -> tuple[list[dict] | None, str | None]:
    """将 tasks 参数规范为子任务 dict 列表。支持 JSON 字符串或数组（模型常传 object）。"""
    if isinstance(tasks, list):
        task_list = tasks
    elif isinstance(tasks, str):
        try:
            parsed = json.loads(tasks)
        except json.JSONDecodeError as exc:
            return None, f"错误：tasks 参数格式不是合法的 JSON 数组: {exc}"
        if not isinstance(parsed, list):
            return None, "错误：tasks JSON 必须是数组。"
        task_list = parsed
    else:
        return None, "错误：tasks 必须是 JSON 数组字符串或数组。"

    if len(task_list) == 0:
        return None, "错误：tasks 不能为空，至少需要一个子任务。"

    normalized: list[dict] = []
    for i, item in enumerate(task_list):
        if not isinstance(item, dict):
            return None, f"错误：子任务 #{i} 必须是对象。"
        normalized.append(item)
    return normalized, None


@tool
def list_workspace_employees() -> str:
    """列出当前工作空间所有数字员工及其角色、技能、MCP 外接能力。

    系统 Prompt 已注入员工表时优先用表；招聘后或表可能过期时再调用。
    """
    db = get_db()
    workspace_id = get_workspace_id()
    return build_employee_capability_context(db, workspace_id)


@tool
def create_orchestration_plan(summary: str, tasks: str | list[Any]) -> str:
    """创建任务编排计划。调用时机：确认任务拆解和员工分配无误后调用。

    参数:
      summary: 编排计划的中文描述
      tasks: JSON 数组字符串，或直接传数组；每个元素格式:
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

    task_list, parse_error = parse_orchestration_task_list(tasks)
    if parse_error:
        return parse_error
    assert task_list is not None

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

    created_tasks: list[EmployeeTask] = []
    for t in task_list:
        cron_expr = t.get("cron")
        emp = db.get(Employee, t["employee_id"])
        task = EmployeeTask(
            workspace_id=workspace_id,
            employee_id=t["employee_id"],
            employee_name_snapshot=emp.name if emp else "",
            task_name=t["task_name"],
            dispatch_type=t.get("dispatch_type", "skill"),
            skill_id=t.get("skill_id"),
            cron_expression=cron_expr if cron_expr else "",
            cron_expression_type="custom",
            user_prompt=t.get("prompt", ""),
            execute_mode="scheduled" if cron_expr else "immediate",
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
        "tasks": tasks_for_event,
    })

    plan_json_output = json.dumps({
        "type": "plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "tasks": tasks_for_event,
    }, ensure_ascii=False)

    return (
        plan_json_output
        + "\n\n"
        + f"编排计划 #{plan.id} 已生成，包含 {len(task_list)} 个子任务。\n"
        f"tasks[].task_id 为 employee_tasks 主键；plan_id={plan.id} 不可用于 "
        "delete_task/update_task。\n"
        f"按系统 Prompt「确认策略」决定是否立即调用 confirm_orchestration_plan({plan.id})；"
        "复杂任务须等用户确认。执行只能通过该 confirm 工具生效。"
    )


@tool
def confirm_orchestration_plan(plan_id: int) -> str:
    """启动编排计划下所有子任务（各员工在独立会话执行）。

    简单任务可在 create 后同一轮调用；复杂任务须用户明确确认后再调用。
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
def update_task(
    task_id: int,
    task_name: str | None = None,
    prompt: str | None = None,
    cron: str | None = None,
    employee_id: int | None = None,
) -> str:
    """修改已存在的子任务。参数均可选，只更新传入的非 None 字段。"""
    workspace_id = get_workspace_id()
    result = _update_task_with_fresh_session(
        workspace_id,
        task_id,
        task_name=task_name,
        prompt=prompt,
        cron=cron,
        employee_id=employee_id,
    )
    if result.get("error"):
        return f"错误：{result['error']}"

    changed = result.get("changed") or []
    if not changed:
        return result.get("message") or "未做任何修改。"

    if "调度时间" in changed:
        from src.service.task_scheduler_service import TaskSchedulerService

        TaskSchedulerService.reload_jobs()
    invalidate_orchestrator_db_cache()
    return result.get("message") or f"任务 #{task_id} 已更新。"


@tool
def delete_task(task_id: int) -> str:
    """删除单个子任务（物理删除，关联的执行记录会保留但 task_id 置空）。"""
    workspace_id = get_workspace_id()
    result = _delete_task_with_fresh_session(workspace_id, task_id)
    if result.get("error"):
        return f"错误：{result['error']}"

    from src.service.task_scheduler_service import TaskSchedulerService

    TaskSchedulerService.reload_jobs()
    invalidate_orchestrator_db_cache()
    task_name = result.get("task_name") or ""
    return f"任务 #{task_id} ({task_name}) 已删除。"


@tool
def delete_tasks_batch(task_ids: str) -> str:
    """批量删除多个子任务（一次调用，逐任务独立 Session，整批只刷新调度一次）。

    当用户要求删除 2 个及以上任务时使用本工具，不要用同一轮多次 delete_task。

    参数 task_ids: JSON 整数数组字符串，例如 "[31, 32, 33]"
    """
    workspace_id = get_workspace_id()

    try:
        parsed = json.loads(task_ids)
    except json.JSONDecodeError as exc:
        return f"错误：task_ids 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list):
        return "错误：task_ids 必须为 JSON 数组。"
    if len(parsed) == 0:
        return "错误：task_ids 不能为空。"
    if len(parsed) > MAX_TASK_DELETE_BATCH:
        return f"错误：单次最多删除 {MAX_TASK_DELETE_BATCH} 个任务。"

    normalized: list[int] = []
    for i, raw in enumerate(parsed):
        try:
            normalized.append(int(raw))
        except (TypeError, ValueError):
            return f"错误：task_ids[{i}] 不是有效整数: {raw!r}"

    raw = run_delete_tasks_batch(workspace_id, normalized, reload_scheduler=True)
    if not raw.startswith("错误："):
        invalidate_orchestrator_db_cache()
    return raw


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


@tool
def list_tasks(
    status: str | None = None,
    plan_id: int | None = None,
    employee_id: int | None = None,
    limit: int = 20,
) -> str:
    """查询工作空间任务状态（数据库快照，非员工实时流）。

    适用：用户询问进度/结果、管理已有计划、多子任务汇总。
    禁止：confirm_orchestration_plan 之后为等待完成而反复调用；界面已有任务执行卡片。
    建议：带 plan_id 精确查询；limit 宜 ≤ 5。
    """
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
