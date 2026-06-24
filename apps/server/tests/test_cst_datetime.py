def test_cst_and_cst_now_importable_from_core_and_workspace():
    from src.core.cst import CST, cst_now
    from src.models.workspace import CST as CST2, cst_now as cst_now2
    from datetime import timezone, timedelta

    assert CST == timezone(timedelta(hours=8))
    assert CST is CST2 and cst_now is cst_now2  # re-export 同一对象
    assert cst_now().tzinfo == CST
