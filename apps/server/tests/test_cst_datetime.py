def test_cst_and_cst_now_importable_from_core_and_workspace():
    from src.core.cst import CST, cst_now
    from src.models.workspace import CST as CST2, cst_now as cst_now2
    from datetime import timezone, timedelta

    assert CST == timezone(timedelta(hours=8))
    assert CST is CST2 and cst_now is cst_now2  # re-export 同一对象
    assert cst_now().tzinfo == CST


def test_cstdatetime_bind_and_result_roundtrip():
    from src.db.types import CstDateTime
    from src.core.cst import CST
    from datetime import datetime, timezone, timedelta
    t = CstDateTime()
    # bind: aware → 归一 CST → naive 存盘
    aware_utc = datetime(2026, 6, 23, 5, 43, 20, tzinfo=timezone.utc)  # =13:43:20 CST
    bound = t.process_bind_param(aware_utc, None)
    assert bound.tzinfo is None and bound.hour == 13 and bound.minute == 43
    # bind: naive 视为 CST 本地，原样存
    naive = datetime(2026, 6, 23, 13, 43, 20)
    assert t.process_bind_param(naive, None) == naive
    # bind/result: None
    assert t.process_bind_param(None, None) is None
    assert t.process_result_value(None, None) is None
    # result: naive 读出补 CST
    r = t.process_result_value(naive, None)
    assert r.tzinfo == CST and r.hour == 13
    # result: 万一 aware（非SQLite）→ astimezone(CST)
    r2 = t.process_result_value(aware_utc, None)
    assert r2.tzinfo == CST and r2.hour == 13


def test_cstdatetime_cache_ok():
    from src.db.types import CstDateTime
    assert CstDateTime.cache_ok is True


def test_workspace_authorized_dir_created_at_is_cst_aware(db_session):
    from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir
    from src.core.cst import cst_now

    d = WorkspaceAuthorizedDir(workspace_id=1, path="/x")
    db_session.add(d)
    db_session.commit()
    db_session.expire_all()

    got = db_session.get(WorkspaceAuthorizedDir, d.id)
    assert got.created_at.tzinfo is not None
    # +8h bug would be 28800s off; 300s tolerance catches it
    assert abs((cst_now() - got.created_at).total_seconds()) < 300


def test_db_datetime_columns_read_back_cst_aware(db_session):
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.workspace import Workspace
    from src.core.cst import CST, cst_now
    from datetime import datetime, timedelta

    ws = Workspace(name="w", root_path="/tmp/w", user_id="u")
    db_session.add(ws)
    db_session.flush()
    # 写 naive run_at（模拟生产）
    plan = OrchestrationPlan(
        workspace_id=ws.id,
        conversation_id=1,
        user_input="x",
        plan_json="[]",
        status="confirmed",
        schedule_kind="once",
        run_at=datetime.now() + timedelta(hours=1),
    )
    db_session.add(plan)
    db_session.commit()
    db_session.expire_all()
    got = db_session.get(OrchestrationPlan, plan.id)
    assert got.run_at.tzinfo == CST and got.created_at.tzinfo == CST
    # 关键：与 cst_now() 直接比较不再抛 TypeError
    assert (got.run_at <= cst_now()) in (True, False)
