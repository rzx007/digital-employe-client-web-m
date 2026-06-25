"""A5: add_workbench_widget 工具测试。"""
from src.service.agent.orchestrator.tools.workbench import _add_widget_impl


def test_add_widget_impl_ok(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "kpi", "title": "销售", "data": {"items": []}})
    assert "已添加" in msg


def test_add_widget_impl_bad_type(db_session):
    msg = _add_widget_impl(db_session, "u1", {"type": "pie", "title": "x", "data": {"a": 1}})
    assert "错误" in msg
