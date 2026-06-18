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

from src.db.session import get_session_local

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


def _load_accepted_task_ids(db: Session, task_ids: list[int]) -> set[int]:
    """直查 DB 取"已 QA 接受"的前置 task 集合：存在 success/completed 且 qa_accepted_at 非空的 log。
    直查而非走 _log_status_by_task 的 set——后者表达不了"哪条 log 被接受"。"""
    from src.models.task_execution_log import TaskExecutionLog
    if not task_ids:
        return set()
    rows = db.execute(
        select(TaskExecutionLog.task_id)
        .where(
            TaskExecutionLog.task_id.in_(task_ids),
            TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
            TaskExecutionLog.qa_accepted_at.is_not(None),
        )
        .distinct()
    ).all()
    return {r[0] for r in rows}


def _all_prereqs_accepted(dep_ids: list[int], accepted_ids: set[int]) -> bool:
    """所有前置都已 QA 接受 → 下游可派。"""
    return all(d in accepted_ids for d in dep_ids)


def waiting_status_for_task(db: Session, task, *, _plan_cache: dict | None = None) -> str | None:
    """编排计划内、当前无 live log 的任务"为何没动"的可读状态。非计划任务 → None。
    待放行(前置全 QA 接受) / 等待前置「X」(前置未接受) / 待派发(根任务无前置)。纯只读。
    _plan_cache：调用方可传 {} 跨多任务复用同一 plan 的 dep_map/accepted，避免重复加载。"""
    from src.models.orchestration_plan import OrchestrationPlan

    plan_id = getattr(task, "orchestration_plan_id", None)
    if plan_id is None:
        return None
    cache = _plan_cache if _plan_cache is not None else {}
    if plan_id not in cache:
        plan = db.get(OrchestrationPlan, plan_id)
        if plan is None:
            cache[plan_id] = None
        else:
            ptasks = _load_plan_tasks(db, plan_id)
            dep_map, _succ = build_dependency_maps(ptasks, json.loads(plan.plan_json or "[]"))
            accepted = _load_accepted_task_ids(db, [t.id for t in ptasks])
            cache[plan_id] = (dep_map, accepted, {t.id: t for t in ptasks})
    entry = cache[plan_id]
    if entry is None:
        return None
    dep_map, accepted, by_id = entry
    dep_ids = dep_map.get(task.id, [])
    if not dep_ids:
        return "待派发"
    if all(d in accepted for d in dep_ids):
        return "待放行"
    pending = [by_id[d].task_name for d in dep_ids if d not in accepted and d in by_id]
    if pending:
        return f"等待前置「{pending[0]}」" + ("等" if len(pending) > 1 else "")
    return "等待前置"


def task_prereqs_accepted(db: Session, task) -> bool:
    """该任务的所有前置是否都已 QA 接受(根任务无前置 → True)。返工 gate 用。"""
    from src.models.orchestration_plan import OrchestrationPlan

    if task.orchestration_plan_id is None:
        return True
    plan = db.get(OrchestrationPlan, task.orchestration_plan_id)
    if plan is None:
        return True
    tasks = _load_plan_tasks(db, plan.id)
    plan_json_obj = json.loads(plan.plan_json or "[]")
    dep_map, _successors = build_dependency_maps(tasks, plan_json_obj)
    dep_ids = dep_map.get(task.id, [])
    if not dep_ids:
        return True
    return _all_prereqs_accepted(dep_ids, _load_accepted_task_ids(db, dep_ids))


def invalidate_downstream(task_id: int) -> list[int]:
    """返工 task_id 时,递归作废其下游子树(传递闭包):
    已交付(success/completed)→ superseded;在飞(running/queued/pending)→ 先 superseded
    并 commit、再取消其流。failed/skipped/superseded 不动(非目标)。返回被作废的 task_id。
    自管独立 session(在调用方 rework.py 自己 commit 之后调,读到已提交状态)。"""
    from src.models.employee_task import EmployeeTask
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.chat_service import ChatService

    db = get_session_local()()
    try:
        task = db.get(EmployeeTask, task_id)
        if task is None or task.orchestration_plan_id is None:
            return []
        plan = db.get(OrchestrationPlan, task.orchestration_plan_id)
        if plan is None:
            return []
        tasks = _load_plan_tasks(db, plan.id)
        plan_json_obj = json.loads(plan.plan_json or "[]")
        _dep_map, successors = build_dependency_maps(tasks, plan_json_obj)

        invalidated: list[int] = []
        seen: set[int] = set()
        queue: list[int] = list(successors.get(task_id, []))
        while queue:
            cid = queue.pop(0)
            if cid in seen:
                continue
            seen.add(cid)
            queue.extend(successors.get(cid, []))
            log = db.scalars(
                select(TaskExecutionLog)
                .where(TaskExecutionLog.task_id == cid)
                .order_by(TaskExecutionLog.id.desc())
            ).first()
            if log is None:
                continue
            if log.run_status in ("success", "completed"):
                log.run_status = "superseded"
                log.run_result = "上游返工，已作废待重跑"
                db.commit()
                invalidated.append(cid)
            elif log.run_status in ("running", "queued", "pending"):
                conv_id = log.conversation_id
                log.run_status = "superseded"
                log.run_result = "上游返工，已作废待重跑"
                db.commit()
                if conv_id:
                    try:
                        ChatService.cancel_conversation_stream(conv_id)
                    except Exception:
                        logger.warning("cancel in-flight downstream conv=%s failed", conv_id, exc_info=True)
                invalidated.append(cid)
        if invalidated:
            logger.info("invalidate_downstream task=%s invalidated=%s", task_id, invalidated)
        return invalidated
    finally:
        db.close()


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
        accepted_ids = _load_accepted_task_ids(db, [t.id for t in tasks])

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
            if not _all_prereqs_accepted(dep_ids, accepted_ids):
                continue  # 还有前置未被总管接受，等放行对账再来
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

        # ③ 整盘定局（全部 成功/失败/跳过）且本轮无新派发 → 仅记录日志。
        #    最终整合不再由此一次性触发：增量汇报去抖器（report_debouncer）已覆盖
        #    「每个员工任务完成 → notify → 去抖 → 唤醒总管增量汇报」的全程，最后一个
        #    任务的完成事件同样会经去抖落到一次最终整合。这里保留 all_settled 计算/
        #    日志仅供观测，不再调用 trigger_orchestrator_reentry（幂等由 reported_at 负责）。
        if not dispatched:
            all_settled = all(_is_settled(t.id, status_by_task) for t in tasks)
            if all_settled:
                logger.info(
                    "plan=%s 全部任务定局（all_settled）；最终整合由增量汇报去抖器接管",
                    plan.id,
                )
    except Exception:
        logger.error(
            "on_employee_task_completed failed task=%s", task_id, exc_info=True
        )
    finally:
        db.close()


def release_accepted_downstream(orchestrator_conversation_id: int) -> int:
    """总管评审轮收尾对账：对已评审、仍 success、未被打回、尚未接受的 log 盖
    qa_accepted_at 并放行其下游。返回新接受数。幂等（qa_accepted_at 一次性）。"""
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    db = get_session_local()()
    try:
        logs = list(db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.orchestrator_conversation_id == orchestrator_conversation_id,
                TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
                TaskExecutionLog.reported_at.is_not(None),
                TaskExecutionLog.qa_accepted_at.is_(None),
            )
        ).all())
        if not logs:
            return 0
        now = cst_now()
        released: list[tuple[int, int]] = []
        for log in logs:
            log.qa_accepted_at = now
            released.append((log.task_id, log.workspace_id))
        db.commit()
        for task_id, workspace_id in released:
            try:
                on_employee_task_completed(task_id, workspace_id)
            except Exception:
                logger.warning("release downstream for task=%s failed", task_id, exc_info=True)
        logger.info(
            "release_accepted_downstream conv=%s accepted=%d",
            orchestrator_conversation_id, len(released),
        )
        return len(released)
    finally:
        db.close()


def reconcile_accepted_downstream_all(db: Session) -> int:
    """启动对账：扫描所有总管会话中"漏接受"的 log，逐会话放行。返回总接受数。"""
    from src.models.task_execution_log import TaskExecutionLog
    conv_ids = [
        r[0] for r in db.execute(
            select(TaskExecutionLog.orchestrator_conversation_id).where(
                TaskExecutionLog.orchestrator_conversation_id.is_not(None),
                TaskExecutionLog.run_status.in_(_PREREQ_DONE_STATES),
                TaskExecutionLog.reported_at.is_not(None),
                TaskExecutionLog.qa_accepted_at.is_(None),
            ).distinct()
        ).all()
    ]
    total = 0
    for cid in conv_ids:
        total += release_accepted_downstream(cid)
    return total


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
