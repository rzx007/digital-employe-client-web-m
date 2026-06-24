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
