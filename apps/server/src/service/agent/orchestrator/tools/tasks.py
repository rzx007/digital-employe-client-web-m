"""子任务管理工具：列表 / 更新 / 单删 / 批量删。"""

from __future__ import annotations

import json

from langchain_core.tools import tool
from sqlalchemy.exc import DBAPIError

from src.service.agent.orchestrator.runtime import (
    get_workspace_id,
    invalidate_orchestrator_db_cache,
)
from src.service.agent.orchestrator.task_listing import (
    _is_sqlite_session_error,
    list_tasks_text,
)
from src.service.agent.orchestrator.task_mutations import (
    MAX_TASK_DELETE_BATCH,
    _delete_task_with_fresh_session,
    _update_task_with_fresh_session,
    delete_tasks_batch as run_delete_tasks_batch,
)


@tool
def update_task(
    task_id: int,
    task_name: str | None = None,
    prompt: str | None = None,
    cron: str | None = None,
    employee_id: int | None = None,
) -> str:
    """修改已存在的子任务。参数均可选，只更新传入的非 None 字段。

    task_id 来自 create_orchestration_plan 返回的 tasks[].task_id（不是 employee_id / plan_id）。
    cron：标准 5 段表达式「分 时 日 月 周」。如 "30 9 * * *"=每天 9:30；"*/10 * * * *"=每 10 分钟重复。
    标准 cron **无法表达"仅一次"**——"33 14 * * *" 会每天 14:33 重复；只跑一次用 cron=null（confirm 后立即执行）。
    """
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
def list_tasks(
    status: str | None = None,
    plan_id: int | None = None,
    employee_id: int | None = None,
    limit: int = 20,
    include_result_detail: bool = False,
) -> str:
    """查询工作空间已配置任务（employee_tasks 表快照，非员工实时流）。

    适用：
    - 用户问「某员工有没有/有哪些定时任务」→ employee_id=该员工 ID（Prompt 员工表有摘要，需 cron/详情时用本工具）
    - 用户追问某编排计划进度 → plan_id=计划 ID
    - 委派快照缺失或与用户描述矛盾时的补充查询
    禁止：confirm 后反复轮询；Prompt 表已能回答「有没有」时勿重复调用。
    默认只返回紧凑表格，不含完整交付正文。
    仅当任务 ≤5 条且 include_result_detail=true 时，可附带极短结果摘要。
    """
    workspace_id = get_workspace_id()
    try:
        return list_tasks_text(
            workspace_id,
            status=status,
            plan_id=plan_id,
            employee_id=employee_id,
            limit=limit,
            include_result_detail=include_result_detail,
        )
    except DBAPIError as exc:
        if _is_sqlite_session_error(exc):
            return (
                "错误：数据库连接暂时不可用（SQLite 并发冲突）。"
                "请稍后重试一次；若仍失败请重启应用。"
            )
        raise
