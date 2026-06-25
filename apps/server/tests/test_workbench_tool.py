"""A5: add_workbench_widget 工具测试。"""
from src.service.agent.orchestrator.tools import workbench as wb
from src.service.agent.orchestrator.tools.workbench import _add_widget_impl


def test_add_widget_impl_ok(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "kpi", "title": "销售", "data": {"items": []}})
    assert "已添加" in msg


def test_add_widget_impl_bad_type(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "pie", "title": "x", "data": {"a": 1}})
    assert "错误" in msg


def test_notify_pushes_workbench_changed(monkeypatch):
    """总管加 widget 后必须推 workbench_changed 事件,否则前端不会即时刷新。"""
    pushed: list = []
    monkeypatch.setattr(wb, "get_workspace_id", lambda: 7)
    from src.service.workspace_events import WorkspaceEventBus

    monkeypatch.setattr(
        WorkspaceEventBus,
        "push",
        classmethod(lambda cls, ws_id, ev: pushed.append((ws_id, ev))),
    )
    wb._notify_workbench_changed()
    assert pushed == [(7, {"type": "workbench_changed"})]
