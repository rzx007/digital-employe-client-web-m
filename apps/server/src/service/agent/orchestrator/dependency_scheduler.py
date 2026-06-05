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
# 失败终态：前置失败 → 下游级联跳过（fail-fast）。
_TERMINAL_FAIL_STATES = ("failed", "cancelled", "timeout", "error")
# 因前置失败而被级联跳过（合成日志状态，非真实执行）。
_SKIPPED_STATE = "skipped"
# "已定局"的终态集合：成功 / 失败 / 跳过。用于判断计划是否全部结束（触发汇总）。
_SETTLED_STATES = _PREREQ_DONE_STATES + _TERMINAL_FAIL_STATES + (_SKIPPED_STATE,)
# 代表"已经在跑或已派出/已定局，不应重复派发"的状态
_ALREADY_DISPATCHED_STATES = (
    "running",
    "queued",
    *_PREREQ_DONE_STATES,
    *_TERMINAL_FAIL_STATES,
    _SKIPPED_STATE,
)


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


def build_class_map(tasks: list, plan_json_obj: list[dict]) -> dict[int, str | None]:
    """task.id -> 总管显式标注的难度类别（plan_json 的 'cls'，heavy/light）。

    无标注则为 None，由下游 resolve_stream_class 按来源推导默认值。
    与 build_dependency_maps 同样按 tasks 顺序对应 plan_json 下标。
    """
    out: dict[int, str | None] = {}
    for i, t in enumerate(tasks):
        raw = plan_json_obj[i].get("cls") if i < len(plan_json_obj) else None
        out[t.id] = raw if raw in ("heavy", "light") else None
    return out


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


def _any_prereq_failed(dep_ids: list[int], status_by_task: dict[int, set[str]]) -> bool:
    """任一前置处于失败终态或已被级联跳过 → 该任务拿不到完整输入。"""
    fail_or_skip = set(_TERMINAL_FAIL_STATES) | {_SKIPPED_STATE}
    for dep_id in dep_ids:
        if status_by_task.get(dep_id, set()) & fail_or_skip:
            return True
    return False


def _is_settled(task_id: int, status_by_task: dict[int, set[str]]) -> bool:
    """任务是否已定局（成功/失败/跳过），用于判断整盘是否结束。"""
    return any(s in _SETTLED_STATES for s in status_by_task.get(task_id, set()))


def _record_skip(db: Session, task, workspace_id: int, reason: str) -> None:
    """为被级联跳过的任务写一条 skipped 执行日志（纳入 DB 派生状态）。"""
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now

    now = cst_now()
    db.add(
        TaskExecutionLog(
            task_id=task.id,
            workspace_id=workspace_id,
            employee_id=task.employee_id,
            skill_id=getattr(task, "skill_id", None),
            task_name_snapshot=task.task_name,
            run_status=_SKIPPED_STATE,
            run_result=reason[:255],
            input_json=task.task_input_json or "{}",
            output_json="{}",
            started_at=now,
            ended_at=now,
        )
    )
    db.commit()


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
    """某员工任务进入终态时的回调入口（成功/失败/取消均会触发）。

    由 server._on_task_finalized 在终态分支调用。每次都从 DB 真实状态重新评估整盘：
      ① 级联跳过：前置失败 → 下游 fail-fast 标 skipped（传播到底）；
      ② 派发：前置全部成功的后继现在可派；
      ③ 整盘全部定局（成功/失败/跳过）→ 触发组长汇总（不再因失败永久僵死）。
    使用独立 Session（回调发生在流终态化的 DB 上下文之外）。
    """
    if task_id is None:
        return

    from src.db.session import get_session_local
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.agent.orchestrator.runtime import can_assign_to_employee

    # 终态通知前端：任务进入终态（成功/失败/跳过）→ 推 task_completed，
    # 让群聊右侧 DAG 面板把该节点从"进行中"刷新到"已交付/失败"。
    # 后端历史上只在任务“开始”时发 task_started，从不发 task_completed，
    # 导致前端 DAG 停在 running 不更新；这里补齐完成侧事件。
    try:
        from src.service.workspace_events import WorkspaceEventBus

        WorkspaceEventBus.push(workspace_id, {
            "type": "task_completed",
            "task_id": task_id,
            "conversation_id": None,
        })
    except Exception:
        logger.warning(
            "push task_completed failed task=%s", task_id, exc_info=True
        )

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

        dep_map, _successors = build_dependency_maps(tasks, plan_json_obj)
        cls_by_id = build_class_map(tasks, plan_json_obj)  # 总管显式 heavy/light

        # 计划内任务通常很少，直接全量加载状态——逻辑更简单，且天然支持级联传播。
        status_by_task = _log_status_by_task(db, [t.id for t in tasks])

        # ① 级联跳过（fail-fast）：前置失败 → 下游拿不到完整输入，标 skipped；
        #    循环传播直到稳定（被跳过的任务又会让它的下游级联跳过）。
        skipped: list[int] = []
        changed = True
        while changed:
            changed = False
            for t in tasks:
                if _is_settled(t.id, status_by_task) or _already_dispatched(
                    t.id, status_by_task
                ):
                    continue
                if _any_prereq_failed(dep_map.get(t.id, []), status_by_task):
                    _record_skip(db, t, workspace_id, "前置任务失败，已级联跳过")
                    status_by_task.setdefault(t.id, set()).add(_SKIPPED_STATE)
                    skipped.append(t.id)
                    changed = True
        if skipped:
            logger.info(
                "task=%s failed → cascade-skipped=%s (plan=%s)",
                task_id, skipped, plan.id,
            )

        # ② 派发：前置全部成功、且未派过/未定局的"有依赖任务"现在可派。
        #    无依赖的根任务由 start_immediate_tasks 首发，这里不抢（见历史注释）。
        dispatched: list[int] = []
        for t in tasks:
            cid = t.id
            if _already_dispatched(cid, status_by_task):
                continue  # 已在跑/已派/已定局（含 skipped），幂等跳过
            dep_ids = dep_map.get(cid, [])
            if not dep_ids:
                continue
            if not _all_prereqs_done(dep_ids, status_by_task):
                continue  # 还有前置没完成，等下一次完成事件再来
            employee = db.get(Employee, t.employee_id)
            if employee is None:
                logger.warning("successor task=%s employee missing, skip", cid)
                continue
            if not can_assign_to_employee(db, t.employee_id):
                logger.info(
                    "successor task=%s employee=%s at capacity, defer",
                    cid, t.employee_id,
                )
                continue

            from src.core.agent_runtime_policy import resolve_stream_class
            from src.service.stream_registry import registry

            stream_cls = resolve_stream_class(cls_by_id.get(cid), "orchestration")
            if not registry.can_admit(stream_cls):
                logger.info(
                    "successor task=%s deferred: no stream slot (class=%s "
                    "inflight=%s heavy=%s)",
                    cid,
                    stream_cls,
                    registry.count_active_streams(),
                    registry.count_active_heavy(),
                )
                continue

            prereq_refs = _collect_prereq_artifacts(db, dep_ids)
            briefing = _build_prereq_briefing(prereq_refs)
            try:
                _dispatch_successor(
                    db, t, employee, workspace_id, briefing,
                    stream_class=cls_by_id.get(cid),
                )
                dispatched.append(cid)
                status_by_task.setdefault(cid, set()).add("running")
            except Exception:
                logger.error("dispatch successor task=%s failed", cid, exc_info=True)

        if dispatched:
            logger.info(
                "task=%s settled → dispatched successors=%s (plan=%s)",
                task_id, dispatched, plan.id,
            )

        # ③ 整盘定局（全部 成功/失败/跳过）且本轮无新派发 → 触发组长汇总。
        #    用 _SETTLED_STATES（含失败/跳过）而非仅成功，避免有失败时汇总永不触发。
        if not dispatched:
            all_settled = all(_is_settled(t.id, status_by_task) for t in tasks)
            if all_settled:
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
    *,
    stream_class: str | None = None,
) -> int:
    """派发一个后继任务：复用 start_task_as_conversation，并把前置产物简报注入 prompt。"""
    from src.service.agent.orchestrator.execution import start_task_as_conversation

    return start_task_as_conversation(
        db,
        task,
        employee,
        workspace_id,
        prereq_briefing=prereq_briefing,
        stream_class=stream_class,
    )
