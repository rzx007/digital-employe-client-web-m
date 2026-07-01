def _seed_ws_plan_sc(db):
    from src.models.workspace import Workspace
    from src.models.orchestration_plan import OrchestrationPlan
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db.add(ws); db.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="查热搜并总结",
        plan_json="[]", status="confirmed", total_tasks=0)
    db.add(plan); db.flush()
    return ws, plan


def test_plan_has_schedule_kind_and_run_at_columns():
    from src.models.orchestration_plan import OrchestrationPlan
    cols = OrchestrationPlan.__table__.columns
    assert "schedule_kind" in cols
    assert "run_at" in cols


def test_parse_schedule_recurring_cron_passthrough(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: (None, None))
    spec = parse_schedule("0 10 * * *", now=cst_now())
    assert spec is not None and spec.kind == "recurring" and spec.cron == "0 10 * * *"


def test_parse_schedule_once_via_llm(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm",
        lambda text, now: ("once", "2026-06-22 21:34:00"))
    spec = parse_schedule("5分钟后提醒", now=cst_now())
    assert spec.kind == "once" and spec.run_at is not None and spec.cron is None


def test_parse_schedule_recurring_via_llm(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm",
        lambda text, now: ("recurring", "30 9 * * *"))
    spec = parse_schedule("每天上午9点半", now=cst_now())
    assert spec.kind == "recurring" and spec.cron == "30 9 * * *"


def test_parse_schedule_unparseable_returns_none(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: (None, None))
    assert parse_schedule("满月的子时", now=cst_now()) is None


def test_create_scheduled_run_conversation_helper(db_session):
    from src.service.agent.orchestrator.plan_run_service import (
        open_plan_run, create_scheduled_run_conversation,
    )
    from src.models.employee import Employee
    from src.models.conversation import Conversation, ConversationMessage
    from sqlalchemy import select
    import json
    ws, plan = _seed_ws_plan_sc(db_session)
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    conv_id = create_scheduled_run_conversation(db_session, plan, run)
    conv = db_session.get(Conversation, conv_id)
    assert conv.target_type == "curator"
    flags = json.loads(conv.session_flags or "{}")
    assert flags["kind"] == "scheduled_run" and flags["plan_id"] == plan.id and flags["run_seq"] == run.run_seq
    msgs = db_session.scalars(select(ConversationMessage).where(ConversationMessage.conversation_id == conv_id)).all()
    assert any("查热搜并总结" in (m.content or "") for m in msgs)


def test_execute_plan_run_scheduled_opens_new_conversation(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.conversation import Conversation
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.plan_json = '[{"depends_on": null}]'; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()

    seen = {}
    monkeypatch.setattr(ex, "start_immediate_tasks",
        lambda db, tasks, plan, ws_id, run_id, orchestrator_conversation_id=None:
            seen.update(run_id=run_id, orch_conv=orchestrator_conversation_id) or [])

    run = ex.execute_plan_run(db_session, plan, trigger="scheduled", auto_accept=True)
    assert run.trigger == "scheduled" and run.conversation_id is not None
    conv = db_session.get(Conversation, run.conversation_id)
    assert conv.target_type == "curator"  # 新 per-run 会话
    assert seen["run_id"] == run.id and seen["orch_conv"] == run.conversation_id


def test_execute_plan_run_manual_reuses_plan_conversation(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.conversation import Conversation
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.plan_json = '[{"depends_on": null}]'
    conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=1, title="源")
    db_session.add(conv); db_session.flush()
    plan.conversation_id = conv.id; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])
    run = ex.execute_plan_run(db_session, plan, trigger="manual", auto_accept=False)
    assert run.trigger == "manual" and run.conversation_id == conv.id  # 复用创建源会话


def test_execute_plan_scheduled_only_registers(db_session, monkeypatch):
    """定时计划(schedule_kind 非空)：execute_plan 只注册调度、不立即跑、不开 PlanRun。"""
    import src.service.agent.orchestrator.execution as ex
    from src.models.plan_run import PlanRun
    from sqlalchemy import select
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "recurring"; plan.cron = "0 10 * * *"; db_session.commit()
    called = {}
    monkeypatch.setattr("src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        classmethod(lambda cls: called.setdefault("reload", True)))
    ran = {"run": False}
    monkeypatch.setattr(ex, "execute_plan_run", lambda *a, **k: ran.update(run=True))
    msg = ex.execute_plan(db_session, plan, ws.id)
    assert called.get("reload") and not ran["run"]
    assert db_session.scalars(select(PlanRun).where(PlanRun.plan_id == plan.id)).first() is None


def test_execute_plan_immediate_runs_via_primitive(db_session, monkeypatch):
    """即时计划(无 schedule)：execute_plan 走 execute_plan_run(manual)。"""
    import src.service.agent.orchestrator.execution as ex
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = None; plan.cron = None; db_session.commit()
    seen = {}
    monkeypatch.setattr(ex, "execute_plan_run",
        lambda db, p, *, trigger, auto_accept: seen.update(trigger=trigger, auto=auto_accept))
    ex.execute_plan(db_session, plan, ws.id)
    assert seen == {"trigger": "manual", "auto": False}


def test_reload_jobs_task_scan_excludes_all_orchestration_subtasks(db_session):
    from sqlalchemy import select, func
    from src.models.employee_task import EmployeeTask
    from src.models.employee import Employee
    from src.models.workspace import Workspace
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    standalone = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="独立",
        execute_mode="scheduled", cron_expression="0 9 * * *", dispatch_type="skill", is_active=True)
    sub = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="子",
        execute_mode="scheduled", cron_expression="0 9 * * *", dispatch_type="skill",
        orchestration_plan_id=1, is_active=True)
    db_session.add_all([standalone, sub]); db_session.commit()
    rows = db_session.scalars(select(EmployeeTask).where(
        EmployeeTask.is_active.is_(True),
        EmployeeTask.dispatch_type == "skill",
        EmployeeTask.cron_expression.isnot(None),
        func.trim(EmployeeTask.cron_expression) != "",
        EmployeeTask.orchestration_plan_id.is_(None),
    )).all()
    ids = {t.id for t in rows}
    assert standalone.id in ids and sub.id not in ids


def test_reload_jobs_plan_scan_includes_once_and_recurring(db_session):
    from sqlalchemy import select
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.workspace import Workspace, cst_now
    from datetime import timedelta
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    rec = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="r", plan_json="[]",
        status="confirmed", schedule_kind="recurring", cron="0 10 * * *")
    once_future = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="o", plan_json="[]",
        status="confirmed", schedule_kind="once", run_at=cst_now() + timedelta(hours=1))
    once_done = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="d", plan_json="[]",
        status="done", schedule_kind="once", run_at=cst_now() + timedelta(hours=1))
    db_session.add_all([rec, once_future, once_done]); db_session.commit()
    rows = db_session.scalars(select(OrchestrationPlan).where(
        OrchestrationPlan.status == "confirmed",
        OrchestrationPlan.schedule_kind.isnot(None),
    )).all()
    ids = {p.id for p in rows}
    assert rec.id in ids and once_future.id in ids and once_done.id not in ids


def test_run_plan_job_once_auto_stops(db_session, monkeypatch):
    """once 计划跑完 status=done，不再被调度。"""
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.workspace import cst_now
    from sqlalchemy.orm import sessionmaker
    from datetime import timedelta
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "once"; plan.run_at = cst_now() + timedelta(minutes=5)
    db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "execute_plan_run", lambda *a, **k: None)
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "done"  # once 自停


def test_reload_jobs_once_naive_run_at_does_not_crash(db_session, monkeypatch):
    """回归：run_at 经 SQLite 取出为 naive，reload_jobs 比较 `run_at <= now`（now 为
    CST-aware）不得抛 TypeError。否则 reload_jobs 在确认时崩溃→once 任务永不注册、永不触发。
    复现用户 bug：'3分钟后提醒开会' 确认后从未执行。"""
    import src.service.task_scheduler_service as tss
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.workspace import Workspace
    from sqlalchemy.orm import sessionmaker
    from datetime import datetime, timedelta

    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    # 关键：naive future run_at（无 tzinfo，模拟 SQLite 读出的裸 datetime）
    naive_future = datetime.now() + timedelta(hours=1)
    assert naive_future.tzinfo is None
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="开会",
        plan_json="[]", status="confirmed", schedule_kind="once", run_at=naive_future)
    db_session.add(plan); db_session.commit()
    plan_id = plan.id

    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)

    svc = tss.TaskSchedulerService
    scheduler = svc._get_scheduler()
    if not scheduler.running:
        scheduler.start()
    try:
        svc.reload_jobs()  # 不得抛 TypeError
        assert scheduler.get_job(f"plan:{plan_id}") is not None  # once 任务已注册
    finally:
        scheduler.shutdown(wait=False)
        svc._scheduler = None  # 还原全局单例，避免污染其它测试


def test_run_plan_job_recurring_updates_next_run(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from sqlalchemy.orm import sessionmaker
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "recurring"; plan.cron = "0 10 * * *"; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "execute_plan_run", lambda *a, **k: None)
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "confirmed" and p.last_run_at is not None and p.next_run_at is not None


def test_create_plan_once_sets_run_at(db_session, monkeypatch):
    import src.service.agent.orchestrator.tools.plans as tp
    from src.models.workspace import Workspace, cst_now
    from src.models.employee import Employee
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee_task import EmployeeTask
    from src.service.schedule_parser import ScheduleSpec
    from datetime import timedelta
    from sqlalchemy import select
    monkeypatch.setattr(tp, "get_db", lambda: db_session)
    monkeypatch.setattr(tp, "get_workspace_id", lambda: 1)
    monkeypatch.setattr(tp, "get_conversation_id", lambda: 1)
    monkeypatch.setattr(tp, "parse_schedule",
        lambda s, now: ScheduleSpec(kind="once", run_at=now + timedelta(minutes=5)), raising=False)
    monkeypatch.setattr(tp, "execute_plan", lambda db, plan, ws: "scheduled")
    monkeypatch.setattr(tp, "compute_requires_confirmation", lambda tl, **kw: False)
    ws = Workspace(id=1, name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(id=1, workspace_id=1, name="e", employee_code="c"); db_session.add(emp); db_session.commit()
    tasks = [{"employee_id": 1, "task_name": "提醒", "prompt": "提醒看世界杯", "depends_on": None}]
    tp.create_orchestration_plan.func("世界杯提醒", tasks, schedule="5分钟后")
    plan = db_session.scalars(select(OrchestrationPlan)).first()
    assert plan.schedule_kind == "once" and plan.run_at is not None and plan.cron is None
    sub = db_session.scalars(select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan.id)).first()
    assert sub.execute_mode == "immediate" and (sub.cron_expression or "") == ""


def test_create_plan_recurring_sets_cron(db_session, monkeypatch):
    import src.service.agent.orchestrator.tools.plans as tp
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.schedule_parser import ScheduleSpec
    from sqlalchemy import select
    monkeypatch.setattr(tp, "get_db", lambda: db_session)
    monkeypatch.setattr(tp, "get_workspace_id", lambda: 1)
    monkeypatch.setattr(tp, "get_conversation_id", lambda: 1)
    monkeypatch.setattr(tp, "parse_schedule",
        lambda s, now: ScheduleSpec(kind="recurring", cron="0 10 * * *"), raising=False)
    monkeypatch.setattr(tp, "execute_plan", lambda db, plan, ws: "scheduled")
    monkeypatch.setattr(tp, "compute_requires_confirmation", lambda tl, **kw: False)
    ws = Workspace(id=1, name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(id=1, workspace_id=1, name="e", employee_code="c"); db_session.add(emp); db_session.commit()
    tasks = [{"employee_id": 1, "task_name": "查", "prompt": "查热搜", "depends_on": None}]
    tp.create_orchestration_plan.func("每天查热搜", tasks, schedule="每天10点")
    plan = db_session.scalars(select(OrchestrationPlan)).first()
    assert plan.schedule_kind == "recurring" and plan.cron == "0 10 * * *" and plan.is_recurring is True


def test_scheduled_plan_requires_confirmation():
    from src.service.agent.orchestrator.confirmation_policy import compute_requires_confirmation
    tasks = [{"output_tier": "small", "task_name": "查", "prompt": "查热搜", "depends_on": None}]
    assert compute_requires_confirmation(tasks, has_schedule=True) is True   # 定时一律需确认
    assert compute_requires_confirmation(tasks, has_schedule=False) is False  # 无定时单只读免确认


def test_e2e_once_plan_fire_then_autostop(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.plan_run import PlanRun
    from src.models.conversation import Conversation
    from src.models.workspace import cst_now
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from datetime import timedelta
    import json
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "once"; plan.run_at = cst_now() + timedelta(minutes=5)
    plan.user_input = "5分钟后提醒看世界杯"; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])

    # 触发一次
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "done"  # 自停
        runs = d.scalars(select(PlanRun).where(PlanRun.plan_id == plan_id)).all()
        assert len(runs) == 1 and runs[0].trigger == "scheduled" and runs[0].conversation_id is not None
        conv = d.get(Conversation, runs[0].conversation_id)
        assert json.loads(conv.session_flags or "{}")["kind"] == "scheduled_run"

    # 再触发（模拟误触）→ status=done 直接返回，不再开新 run
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        runs = d.scalars(select(PlanRun).where(PlanRun.plan_id == plan_id)).all()
        assert len(runs) == 1  # 没有第二轮


def test_reload_jobs_marks_expired_once_plan_done(db_session):
    """直接验证语义：一次性计划 run_at 已过且没跑过 → 应被标 done（错过窗口失效）。
    (纯逻辑断言，不启真 APScheduler。)"""
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.workspace import Workspace, CST, cst_now
    from datetime import timedelta
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    expired = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="过期", plan_json="[]",
        status="confirmed", schedule_kind="once", run_at=cst_now() - timedelta(hours=1))
    db_session.add(expired); db_session.commit()
    # 复刻 reload_jobs once 分支的"过期判定"逻辑契约
    # DB 回读的 run_at 可能是 offset-naive（SQLite），统一替换为 CST 再比较
    now = cst_now()
    run_at = expired.run_at
    if run_at is not None and run_at.tzinfo is None:
        run_at = run_at.replace(tzinfo=CST)
    is_missed = (expired.last_run_at is None and run_at is not None and run_at <= now)
    assert is_missed is True


def test_cleanup_legacy_subtask_cron_plans(db_session):
    from src.db.init_db import _cleanup_legacy_subtask_cron_plans
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.orchestration_plan import OrchestrationPlan
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    # 脏：plan 无 cron/schedule_kind，子任务带 cron
    dirty = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="脏", plan_json="[]",
        status="confirmed", cron=None, schedule_kind=None)
    db_session.add(dirty); db_session.flush()
    dt = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="脏子",
        execute_mode="scheduled", cron_expression="30 17 * * *",
        orchestration_plan_id=dirty.id, is_active=True)
    # 合法 recurring（新模型）：plan 有 schedule_kind，子任务无 cron → 不动
    good = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="好", plan_json="[]",
        status="confirmed", cron="0 10 * * *", schedule_kind="recurring")
    db_session.add(good); db_session.flush()
    gt = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="好子",
        execute_mode="immediate", cron_expression="", orchestration_plan_id=good.id, is_active=True)
    db_session.add_all([dt, gt]); db_session.commit()

    _cleanup_legacy_subtask_cron_plans(db_session.get_bind())
    db_session.expire_all()
    assert db_session.get(OrchestrationPlan, dirty.id).status == "cancelled"
    assert db_session.get(EmployeeTask, dt.id).is_active is False
    assert db_session.get(OrchestrationPlan, good.id).status == "confirmed"  # 合法不动
    assert db_session.get(EmployeeTask, gt.id).is_active is True


def test_parse_schedule_relative_minutes_is_once_deterministic(monkeypatch):
    """『N分钟后』确定性判为 once（不依赖 LLM），run_at ≈ now+N 分钟。"""
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    from datetime import timedelta
    # LLM 即便误判 recurring 也不该影响——相对时间走确定性快路
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: ("recurring", "17 9 * * *"))
    now = cst_now()
    spec = parse_schedule("2分钟后口头提醒看世界杯", now=now)
    assert spec is not None and spec.kind == "once" and spec.cron is None
    delta = (spec.run_at - now).total_seconds()
    assert 100 <= delta <= 140  # ~120s


def test_parse_schedule_relative_hours_is_once(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: (None, None))
    now = cst_now()
    spec = parse_schedule("3小时后提醒我", now=now)
    assert spec.kind == "once"
    assert 3*3600 - 60 <= (spec.run_at - now).total_seconds() <= 3*3600 + 60


def test_parse_schedule_recurring_phrase_still_recurring(monkeypatch):
    """『每天X点』不被相对快路误抓，仍走 LLM → recurring。"""
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: ("recurring", "0 10 * * *"))
    spec = parse_schedule("每天10点查热搜", now=cst_now())
    assert spec.kind == "recurring" and spec.cron == "0 10 * * *"
