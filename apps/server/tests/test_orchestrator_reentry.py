import json
from src.models.orchestration_plan import OrchestrationPlan
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from tests.conftest import add_employee
from src.models.conversation import Conversation


def _plan_with_one_task(db, ws_id, emp_id, conv_id):
    plan = OrchestrationPlan(
        workspace_id=ws_id, conversation_id=conv_id, user_input="单任务测试",
        plan_json=json.dumps([{"depends_on": None}]),
        status="confirmed",
    )
    db.add(plan); db.flush()
    t = EmployeeTask(
        workspace_id=ws_id, employee_id=emp_id, task_name="仅测试",
        orchestration_plan_id=plan.id, task_input_json="{}",
        user_prompt="do test", execute_mode="immediate",
    )
    db.add(t); db.flush()
    db.commit()
    return plan, (t,)


def _plan_with_two_tasks(db, ws_id, emp_id, conv_id):
    plan = OrchestrationPlan(
        workspace_id=ws_id, conversation_id=conv_id, user_input="做个东西",
        plan_json=json.dumps([{"depends_on": None}, {"depends_on": None}]),
        status="confirmed",
    )
    db.add(plan); db.flush()
    tasks = []
    for name in ("调研A", "调研B"):
        t = EmployeeTask(
            workspace_id=ws_id, employee_id=emp_id, task_name=name,
            orchestration_plan_id=plan.id, task_input_json="{}",
            user_prompt=f"do {name}", execute_mode="immediate",
        )
        db.add(t); db.flush(); tasks.append(t)
    db.commit()
    return plan, tasks


def test_collect_plan_execution_results(db_session, workspace):
    from src.service.agent.orchestrator.reentry import collect_plan_execution_results
    emp = add_employee(db_session, workspace.id, name="w")
    plan, (a, b) = _plan_with_two_tasks(db_session, workspace.id, emp.id, conv_id=100)
    db_session.add(TaskExecutionLog(
        task_id=a.id, workspace_id=workspace.id, employee_id=emp.id,
        task_name_snapshot="调研A", run_status="success",
        run_result="完成A", output_json=json.dumps({"content": "A 的结论"}),
        orchestrator_conversation_id=100, started_at=cst_now(), ended_at=cst_now(),
        input_json="{}",
    ))
    db_session.add(TaskExecutionLog(
        task_id=b.id, workspace_id=workspace.id, employee_id=emp.id,
        task_name_snapshot="调研B", run_status="failed",
        run_result="失败B", error_message="boom",
        orchestrator_conversation_id=100, started_at=cst_now(), ended_at=cst_now(),
        input_json="{}",
    ))
    db_session.commit()

    results = collect_plan_execution_results(db_session, plan)
    assert len(results) == 2
    by_name = {r["task_name"]: r for r in results}
    assert by_name["调研A"]["status"] == "success"
    assert by_name["调研A"]["content"] == "A 的结论"
    assert by_name["调研B"]["status"] == "failed"
    assert by_name["调研B"]["error"] == "boom"


def test_collect_plan_execution_results_unknown_branch(db_session, workspace):
    """无 TaskExecutionLog 时，返回的 dict 应含全部 5 个键且结构一致。"""
    from src.service.agent.orchestrator.reentry import collect_plan_execution_results
    emp = add_employee(db_session, workspace.id, name="w2")
    plan, (task_a,) = _plan_with_one_task(db_session, workspace.id, emp.id, conv_id=200)
    # 不给 task_a 建任何 TaskExecutionLog
    db_session.commit()

    results = collect_plan_execution_results(db_session, plan)
    assert len(results) == 1
    r = results[0]
    # 必须含全部 5 个键
    assert set(r.keys()) == {"task_name", "status", "content", "result", "error"}
    assert r["task_name"] == "仅测试"
    assert r["status"] == "unknown"
    assert r["content"] == ""
    assert r["result"] == ""
    assert r["error"] is None


def test_build_reentry_brief():
    from src.service.agent.orchestrator.reentry import build_reentry_brief
    results = [
        {"task_name": "调研A", "status": "success", "content": "A结论", "result": "完成A", "error": None},
        {"task_name": "调研B", "status": "failed", "content": "", "result": "失败B", "error": "boom"},
    ]
    brief = build_reentry_brief(results)
    assert "调研A" in brief and "A结论" in brief
    assert "调研B" in brief and ("失败" in brief or "boom" in brief)
    assert "整合" in brief
    assert "$WORKSPACE_DIR" in brief or "工作桌" in brief or "产物" in brief


def test_trigger_reentry_schedules_turn(db_session, workspace, monkeypatch):
    """trigger_orchestrator_reentry 起一轮整合流。

    注：B5 起已移除 plan.status == "summarized" 门闩——幂等改由 per-task
    reported_at 负责（见 test_incremental_report.py），故本函数不再断言「再调一次不重复起流」。
    """
    from src.service.agent.orchestrator import reentry

    conv = Conversation(workspace_id=workspace.id, target_type="curator", target_id=0, title="总管")
    db_session.add(conv); db_session.flush()
    emp = add_employee(db_session, workspace.id, name="w")
    plan, (a, b) = _plan_with_two_tasks(db_session, workspace.id, emp.id, conv_id=conv.id)
    for t, st in ((a, "success"), (b, "success")):
        db_session.add(TaskExecutionLog(
            task_id=t.id, workspace_id=workspace.id, employee_id=emp.id,
            task_name_snapshot=t.task_name, run_status=st,
            output_json=json.dumps({"content": f"{t.task_name} done"}),
            orchestrator_conversation_id=conv.id, started_at=cst_now(), ended_at=cst_now(),
        ))
    db_session.commit()

    started: list[dict] = []
    monkeypatch.setattr(reentry, "_schedule_reentry_stream", lambda **kw: started.append(kw))
    monkeypatch.setattr(reentry, "_new_session", lambda: db_session)
    monkeypatch.setattr(reentry, "_build_orchestrator_agent", lambda **kw: object())

    reentry.trigger_orchestrator_reentry(db_session, plan, workspace.id)
    assert len(started) == 1
    assert started[0]["conversation_id"] == conv.id


def test_all_settled_no_longer_oneshot_triggers_reentry(
    patched_task_mutations_db, db_session, workspace, monkeypatch
):
    """B6 起：调度器 all_settled 分支不再一次性调 trigger_orchestrator_reentry。

    最终整合改由增量汇报去抖器（每任务完成 → notify → 去抖）覆盖，
    幂等由 per-task reported_at 负责。本测断言 all_settled 分支不再触发该一次性调用。
    """
    from src.service.agent.orchestrator import dependency_scheduler as ds

    # 建总管会话（非群，无 GroupRoom）
    conv = Conversation(
        workspace_id=workspace.id, target_type="curator", target_id=0, title="总管"
    )
    db_session.add(conv)
    db_session.flush()

    emp = add_employee(db_session, workspace.id, name="w")
    plan, (a, b) = _plan_with_two_tasks(db_session, workspace.id, emp.id, conv_id=conv.id)

    # 两个任务均已 success
    for t in (a, b):
        db_session.add(TaskExecutionLog(
            task_id=t.id, workspace_id=workspace.id, employee_id=emp.id,
            task_name_snapshot=t.task_name, run_status="success",
            output_json=json.dumps({"content": "done"}),
            orchestrator_conversation_id=conv.id,
            started_at=cst_now(), ended_at=cst_now(),
        ))
    db_session.commit()

    # patch WorkspaceEventBus.push（on_employee_task_completed 内会调）
    monkeypatch.setattr(
        "src.service.workspace_events.WorkspaceEventBus.push",
        lambda ws_id, event: None,
    )

    # patch 源模块属性——若调度器仍调一次性 reentry，这里会捕获到调用
    calls: list = []
    monkeypatch.setattr(
        "src.service.agent.orchestrator.reentry.trigger_orchestrator_reentry",
        lambda db, pl, ws: calls.append((pl.id, ws)),
    )

    ds.on_employee_task_completed(a.id, workspace.id)

    # 不再一次性触发整合（增量去抖接管）
    assert calls == []
