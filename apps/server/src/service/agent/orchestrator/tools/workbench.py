"""工作台 widget 工具：总管向用户工作台看板添加统计块。"""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from src.db.session import get_session_local
from src.service import workbench_service as ws
from src.service.agent.orchestrator.runtime import get_user_id


def _add_widget_impl(db: Session, user_id: str, spec: dict[str, Any]) -> str:
    """内联实现，便于测试直接注入 db session。"""
    try:
        widget = ws.append_widget(db, user_id, spec)
    except Exception as e:
        return f"错误：{e}"
    return f"已添加 widget「{widget.title}」(id={widget.id}) 到工作台。"


@tool
def add_workbench_widget(
    type: str,
    title: str,
    data: dict | None = None,
    data_source: dict | None = None,
    subtitle: str | None = None,
    options: dict | None = None,
) -> str:
    """向当前用户的工作台看板添加一个统计块(widget)。

    type 取值: kpi|line|bar|area|table|progress|list。
    data 与 data_source 至少给一个：data 为内联快照；data_source={"metricId": "...","params":{...}} 绑定实时指标。
    可用 metricId: monthly_performance, task_calendar, today_tasks。
    """
    spec: dict[str, Any] = {"type": type, "title": title}
    if subtitle is not None:
        spec["subtitle"] = subtitle
    if data is not None:
        spec["data"] = data
    if data_source is not None:
        spec["dataSource"] = data_source
    if options is not None:
        spec["options"] = options

    user_id = get_user_id()
    if not user_id:
        return "错误：无法获取当前用户 ID，请确认会话上下文已初始化。"

    db = get_session_local()()
    try:
        return _add_widget_impl(db, user_id, spec)
    finally:
        db.close()
