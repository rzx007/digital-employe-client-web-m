from src.service import workbench_service as ws
from src.models.workbench_config import WorkbenchConfigRow  # noqa


def test_table_registered():
    assert WorkbenchConfigRow.__tablename__ == "workbench_configs"


def test_load_default_when_absent(db_session):
    cfg = ws.load_config(db_session, "u1")
    assert cfg.tabOrder == ["dashboard"]


def test_save_then_load_roundtrip(db_session):
    cfg = ws.load_config(db_session, "u1")
    ws.save_config(db_session, "u1", cfg.model_copy(update={"updatedAt": 123}))
    again = ws.load_config(db_session, "u1")
    assert again.updatedAt == 123


def test_append_widget_validates_and_persists(db_session):
    w = ws.append_widget(db_session, "u1", {"type": "kpi", "title": "x", "data": {"items": []}})
    cfg = ws.load_config(db_session, "u1")
    assert cfg.dashboard.widgets[0].id == w.id


def test_append_widget_rejects_bad_type(db_session):
    import pytest
    with pytest.raises(ValueError):
        ws.append_widget(db_session, "u1", {"type": "__nope__", "title": "x", "data": {"a": 1}})


def test_update_widget(db_session):
    w = ws.append_widget(db_session, "u1", {"type": "kpi", "title": "旧", "data": {"items": []}})
    updated = ws.update_widget(
        db_session, "u1", w.id, {"title": "新", "data": {"items": [{"label": "a", "value": 1}]}}
    )
    assert updated.id == w.id and updated.title == "新"
    cfg = ws.load_config(db_session, "u1")
    assert cfg.dashboard.widgets[0].title == "新"
    assert cfg.dashboard.widgets[0].data == {"items": [{"label": "a", "value": 1}]}


def test_update_widget_not_found(db_session):
    import pytest
    with pytest.raises(ValueError):
        ws.update_widget(db_session, "u1", "wd-nope", {"title": "x"})


def test_upsert_widget_by_key(db_session):
    w1, created1 = ws.upsert_widget(
        db_session, "u1",
        {"type": "kpi", "title": "火力榜", "data": {"items": [{"label": "德国", "value": 10}]}},
        key="wc-fire",
    )
    assert created1 is True
    w2, created2 = ws.upsert_widget(
        db_session, "u1",
        {"type": "kpi", "title": "火力榜", "data": {"items": [{"label": "德国", "value": 11}]}},
        key="wc-fire",
    )
    assert created2 is False and w2.id == w1.id  # 同 key 原地更新,不新建
    cfg = ws.load_config(db_session, "u1")
    assert len(cfg.dashboard.widgets) == 1  # 没重复建卡
    assert cfg.dashboard.widgets[0].data["items"][0]["value"] == 11


def test_list_widgets(db_session):
    ws.append_widget(db_session, "u1", {"type": "kpi", "title": "A", "data": {"items": []}})
    items = ws.list_widgets(db_session, "u1")
    assert len(items) == 1 and items[0].title == "A"
