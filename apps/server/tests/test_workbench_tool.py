"""A5: add_workbench_widget 工具测试。"""
from src.service.agent.orchestrator.tools import workbench as wb
from src.service.agent.orchestrator.tools.workbench import _add_widget_impl


def test_add_widget_impl_ok(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "kpi", "title": "销售", "data": {"items": []}})
    assert "已添加" in msg


def test_add_widget_impl_bad_type(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "__nope__", "title": "x", "data": {"a": 1}})
    assert "错误" in msg


def test_update_widget_impl(db_session):
    import re

    from src.service.agent.orchestrator.tools.workbench import _update_widget_impl

    msg = _add_widget_impl(
        db_session, "u1", {"type": "kpi", "title": "旧", "data": {"items": []}}
    )
    wid = re.search(r"id=(wd-\w+)", msg).group(1)
    out = _update_widget_impl(db_session, "u1", wid, {"title": "新"})
    assert "已更新" in out


def test_update_widget_impl_not_found(db_session):
    from src.service.agent.orchestrator.tools.workbench import _update_widget_impl

    out = _update_widget_impl(db_session, "u1", "wd-nope", {"title": "x"})
    assert "错误" in out


def test_add_impl_upsert_by_key(db_session):
    msg1 = _add_widget_impl(
        db_session, "u1", {"type": "kpi", "title": "榜", "data": {"items": []}}, key="k1"
    )
    assert "已添加" in msg1
    msg2 = _add_widget_impl(
        db_session, "u1", {"type": "kpi", "title": "榜2", "data": {"items": []}}, key="k1"
    )
    assert "已更新" in msg2  # 同 key → upsert


def test_list_widgets_impl(db_session):
    from src.service.agent.orchestrator.tools.workbench import _list_widgets_impl

    _add_widget_impl(db_session, "u1", {"type": "kpi", "title": "销量", "data": {"items": []}})
    out = _list_widgets_impl(db_session, "u1")
    assert "销量" in out and "id=wd-" in out


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
