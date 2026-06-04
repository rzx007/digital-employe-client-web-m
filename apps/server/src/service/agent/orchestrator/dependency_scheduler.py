"""完成驱动的依赖调度器（真·DAG）。

修复历史缺陷（伪 DAG）：旧 `start_immediate_tasks` 在任务**启动时**就给后继
递减依赖计数，导致 "B 等 A 做完" 从未真正发生 —— B 起跑时 A 还没干完。

本模块把触发点改为"**完成才递减**"：当某员工任务真正完成（stream_state=="completed"）
时，由 `stream_registry.on_task_finalized` → `server._on_task_finalized` 调用本模块的
`on_employee_task_completed`，再用 **DB 派生计数**（按 TaskExecutionLog 的完成状态判断
前置是否齐活）解析出现在可派的后继任务并派发。

DB 派生计数而非内存计数器的好处：
- 进程重启不丢状态；
- 多个前置并发完成时无需共享内存锁（每次都从 DB 真实状态重算）。

依赖关系来源：OrchestrationPlan.plan_json（每个元素的 depends_on，支持 int 或 int[]，
取值为"计划内任务的下标"）。计划内任务下标 → task.id 的映射：按任务创建顺序
（id 升序，与 plans.create_orchestration_plan 写入顺序一致）。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# stream/log 中代表"前置已完成、产物可用"的终态
# 注意：TaskExecutionLog.run_status 在完成时被置为 "success"（见 _finalize_task_stream），
# 而 stream_state 终态是 "completed"。两边取值都纳入，避免前置永远不算完成。
_PREREQ_DONE_STATES = ("completed", "success")
# 代表"已经在跑或已派出，不应重复派发"的状态
_ALREADY_DISPATCHED_STATES = ("running", "queued", "completed", "success")


def _load_plan_tasks(db: Session, plan_id: int) -> list:
    """按创建顺序（id 升序）加载计划内的全部任务。

    顺序必须与 plan_json 的下标一致 —— plans.create_orchestration_plan 是按
    task_list 顺序逐条 db.add，故 id 升序即为 plan_json 下标顺序。
    """
    from src.models.employee_task import EmployeeTask

    return list(
        db.scalars(
            select(EmployeeTask)
            .where(EmployeeTask.orchestration_plan_id == plan_id)
            .order_by(EmployeeTask.id.asc())
        ).all()
    )


def _parse_depends_on(raw: Any) -> list[int]:
    """把 plan_json 里的 depends_on 解析成下标列表，支持 int / int[] / null。"""
    if isinstance(raw, bool):  # 防止 True/False 被当作 1/0
        return []
    if isinstance(raw, int):
        return [raw]
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, int) and not isinstance(x, bool)]
    return []


def build_dependency_maps(
    tasks: list, plan_json_obj: list[dict]
) -> tuple[dict[int, list[int]], dict[int, list[int]]]:
    """构造正向/反向依赖映射（均以 task.id 为键）。

    返回：
      dep_map[task_id]      = 该任务依赖的前置 task.id 列表
      successors[task_id]   = 依赖该任务的后继 task.id 列表
    """
    dep_map: dict[int, list[int]] = {}
    successors: dict[int, list[int]] = {}

    for i, t in enumerate(tasks):
        deps: list[int] = []
        raw = plan_json_obj[i].get("depends_on") if i < len(plan_json_obj) else None
        for idx in _parse_depends_on(raw):
            if 0 <= idx < len(tasks) and idx != i:
                dep_task = tasks[idx]
                deps.append(dep_task.id)
        dep_map[t.id] = deps

    for t in tasks:
        successors[t.id] = []
    for tid, deps in dep_map.items():
        for dep_id in deps:
            successors.setdefault(dep_id, []).append(tid)

    return dep_map, successors


def _log_status_by_task(db: Session, task_ids: list[int]) -> dict[int, set[str]]:
    """聚合每个任务的所有执行日志状态集合（一个任务可能有多条日志）。"""
    from src.models.task_execution_log import TaskExecutionLog

    if not task_ids:
        return {}
    rows = db.execute(
        select(TaskExecutionLog.task_id, TaskExecutionLog.run_status).where(
            TaskExecutionLog.task_id.in_(task_ids)
        )
    ).all()
    out: dict[int, set[str]] = {}
    for task_id, run_status in rows:
        if task_id is None:
            continue
        out.setdefault(int(task_id), set()).add(run_status or "")
    return out


def _all_prereqs_done(dep_ids: list[int], status_by_task: dict[int, set[str]]) -> bool:
    """所有前置都至少有一条 completed 日志 → 视为产物已就绪。"""
    for dep_id in dep_ids:
        states = status_by_task.get(dep_id, set())
        if not any(s in _PREREQ_DONE_STATES for s in states):
            return False
    return True


def _already_dispatched(task_id: int, status_by_task: dict[int, set[str]]) -> bool:
    states = status_by_task.get(task_id, set())
    return any(s in _ALREADY_DISPATCHED_STATES for s in states)


def _collect_prereq_artifacts(
    db: Session, dep_ids: list[int]
) -> list[tuple[str, str]]:
    """收集前置任务的产物引用：(任务名, 产物摘要/路径)。

    只取"地址/摘要"，不把全文塞进上下文（防上下文爆炸，对齐 ChatDev/MetaGPT）。
    产物来源：TaskExecutionLog.output_json（completed 那条），其中可能含 artifacts 路径列表。
    """
    from src.models.task_execution_log import TaskExecutionLog

    refs: list[tuple[str, str]] = []
    for dep_id in dep_ids:
        log = db.scalars(
            select(TaskExecutionLog)
            .where(
                TaskExecutionLog.task_id == dep_id,
                TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
            )
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if not log:
            continue
        name = log.task_name_snapshot or f"任务#{dep_id}"
        summary = ""
        blob = log.output_json or "{}"
        paths: list[str] = []
        try:
            output = json.loads(blob)
            if isinstance(output, dict):
                # 结构化 artifacts 字段（若有）
                arts = output.get("artifacts")
                if isinstance(arts, list):
                    paths.extend(str(a) for a in arts)
                # 多数情况产物路径写在 content 文本里
                if output.get("content"):
                    blob = str(output["content"])
                elif output.get("result"):
                    blob = str(output["result"])
        except (json.JSONDecodeError, TypeError):
            pass
        # 从文本里抽出 /artifacts/... 路径（员工通常会写明存到哪）
        for m in _ARTIFACT_PATH_RE.findall(blob + " " + (log.run_result or "")):
            if m not in paths:
                paths.append(m)
        if paths:
            # 关键：明确告诉下游"上游产物在这些共享路径，直接 read 读取"
            summary = "产物文件（在共享 /artifacts/ 下，请用 read 工具读取）：" + "；".join(paths)
        else:
            # 没有显式路径就给一段结论摘要
            text = blob.strip()
            summary = (text[:300] + "…") if len(text) > 300 else text
        refs.append((name, summary or "（已完成）"))
    return refs


# 从文本里提取 /artifacts/... 产物路径
_ARTIFACT_PATH_RE = re.compile(r"/artifacts/[^\s`\"'）)，。、]+")


def _build_prereq_briefing(refs: list[tuple[str, str]]) -> str:
    """把前置产物引用拼成给后继任务的简报片段。"""
    if not refs:
        return ""
    lines = ["", "【前置任务已完成，其产物供你参考（请按需自行读取，勿等待确认）】"]
    for name, summary in refs:
        lines.append(f"- {name}：{summary}")
    return "\n".join(lines)


def on_employee_task_completed(task_id: int | None, workspace_id: int) -> None:
    """某员工任务完成时的回调入口：解析并派发现在可执行的后继任务。

    由 server._on_task_finalized 在 stream_state=="completed" 分支调用。
    使用独立 Session（回调发生在流终态化的 DB 上下文之外）。
    """
    if task_id is None:
        return

    from src.db.session import get_session_local
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.agent.orchestrator.runtime import can_assign_to_employee

    db = get_session_local()()
    try:
        task = db.get(EmployeeTask, task_id)
        if task is None or task.orchestration_plan_id is None:
            return  # 非编排任务（如手动单聊）无后继可派
        plan = db.get(OrchestrationPlan, task.orchestration_plan_id)
        if plan is None:
            return

        tasks = _load_plan_tasks(db, plan.id)
        if not tasks:
            return
        plan_json_obj: list[dict] = json.loads(plan.plan_json or "[]")

        dep_map, successors = build_dependency_maps(tasks, plan_json_obj)

        # 候选 = 刚完成任务的直接后继 + 其它"有前置依赖"的任务。
        # 只纳入"有依赖"的任务（dep_map 非空）做容量重试，避免把无依赖的根任务
        # 误当作"待重试"重新派出 —— 无依赖的根任务由 start_immediate_tasks 负责首发，
        # 其因并发上限被推迟时，会在某员工腾出槽后由其后继链或下次完成事件带动。
        # 排除刚完成的任务自身。
        dependent_ids = [
            t.id for t in tasks if t.id != task_id and dep_map.get(t.id)
        ]
        candidate_ids = list(
            dict.fromkeys(successors.get(task_id, []) + dependent_ids)
        )

        # 一次性聚合相关任务的日志状态（候选 + 它们的前置）
        relevant_ids: set[int] = set(candidate_ids)
        for cid in candidate_ids:
            relevant_ids.update(dep_map.get(cid, []))
        status_by_task = _log_status_by_task(db, list(relevant_ids))

        task_by_id = {t.id: t for t in tasks}
        dispatched: list[int] = []

        for cid in candidate_ids:
            successor = task_by_id.get(cid)
            if successor is None:
                continue
            if _already_dispatched(cid, status_by_task):
                continue  # 已在跑/已派/已完成，跳过（幂等）
            dep_ids = dep_map.get(cid, [])
            if not _all_prereqs_done(dep_ids, status_by_task):
                continue  # 还有前置没完成，等下一次完成事件再来
            employee = db.get(Employee, successor.employee_id)
            if employee is None:
                logger.warning("successor task=%s employee missing, skip", cid)
                continue
            if not can_assign_to_employee(db, successor.employee_id):
                logger.info(
                    "successor task=%s employee=%s at capacity, defer",
                    cid,
                    successor.employee_id,
                )
                continue

            # 拼接前置产物引用到简报
            prereq_refs = _collect_prereq_artifacts(db, dep_ids)
            briefing = _build_prereq_briefing(prereq_refs)

            try:
                _dispatch_successor(db, successor, employee, workspace_id, briefing)
                dispatched.append(cid)
            except Exception:
                logger.error(
                    "dispatch successor task=%s failed", cid, exc_info=True
                )

        if dispatched:
            logger.info(
                "task=%s completed → dispatched successors=%s (plan=%s)",
                task_id,
                dispatched,
                plan.id,
            )

        # 全部任务完成且没有新派发 → 触发组长汇总（若属于群房间）
        if not dispatched:
            all_status = _log_status_by_task(db, [t.id for t in tasks])
            all_done = all(
                any(s in _PREREQ_DONE_STATES for s in all_status.get(t.id, set()))
                for t in tasks
            )
            if all_done:
                _trigger_leader_summary_if_room(db, plan, workspace_id)
    except Exception:
        logger.error(
            "on_employee_task_completed failed task=%s", task_id, exc_info=True
        )
    finally:
        db.close()


def _trigger_leader_summary_if_room(db: Session, plan, workspace_id: int) -> None:
    """编排计划全部完成后，若属于群房间，让组长读取成员产物做最终汇总。

    幂等：用 plan 状态标记，避免重复触发。
    """
    from src.models.group_room import GroupRoom

    room = db.scalars(
        select(GroupRoom).where(
            GroupRoom.leader_conversation_id == plan.conversation_id
        )
    ).first()
    if room is None:
        return
    # 幂等标记：plan.status 置为 summarized 后不再触发
    if plan.status == "summarized":
        return
    plan.status = "summarized"
    db.commit()

    try:
        from src.service.group_room_service import GroupRoomService

        GroupRoomService.summarize_by_leader(db, room)
        logger.info("triggered leader summary for room=%s plan=%s", room.id, plan.id)
    except Exception:
        logger.error(
            "leader summary failed room=%s plan=%s", room.id, plan.id, exc_info=True
        )


def _dispatch_successor(
    db: Session,
    task,
    employee,
    workspace_id: int,
    prereq_briefing: str,
) -> int:
    """派发一个后继任务：复用 start_task_as_conversation，并把前置产物简报注入 prompt。"""
    from src.service.agent.orchestrator.execution import start_task_as_conversation

    return start_task_as_conversation(
        db,
        task,
        employee,
        workspace_id,
        prereq_briefing=prereq_briefing,
    )
