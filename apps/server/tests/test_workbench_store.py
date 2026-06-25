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
