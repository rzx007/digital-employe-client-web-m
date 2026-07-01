"""子任务管理工具：列表 / 更新 / 单删 / 批量删。"""

from __future__ import annotations

import json

from langchain_core.tools import tool
from sqlalchemy.exc import DBAPIError

from src.service.agent.orchestrator.runtime import (
    get_conversation_id,
    get_workspace_id,
    invalidate_orchestrator_db_cache,
)
from src.service.agent.orchestrator.task_listing import (
    _POLL_STOP_DIRECTIVE,
    _is_sqlite_session_error,
    _record_poll_and_should_block,
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
    # 硬闸：同一会话短窗口内重复轮询超阈值 → 返回「停手」指令而非状态表，
    # 终结「确认计划后反复 list_tasks」死循环（流永不结束、会话停不掉）。
    if _record_poll_and_should_block(get_conversation_id()):
        return _POLL_STOP_DIRECTIVE
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


@tool
def redispatch_task(task_id: int, rework_note: str) -> str:
    """判定某子任务交付【不达标】时，打回让该员工在原对话续聊返工。

    用于总管一线质检：对照该任务派活契约的「输出」，若交付缺项/跑偏/质量不够，
    调本工具打回——员工会带着上一稿在同一对话里按你的说明修改。

    task_id：来自 create_orchestration_plan 返回的 tasks[].task_id。
    rework_note：把「哪里不达标 + 要改成什么样」讲清楚（员工据此修订）。
    每个任务最多自动返工 2 次，超限本工具会拒绝并提示你升级给领导定夺。
    """
    from src.service.agent.orchestrator.rework import redispatch_task_in_session
    workspace_id = get_workspace_id()
    msg = redispatch_task_in_session(workspace_id, task_id, rework_note or "")
    invalidate_orchestrator_db_cache()
    return msg
