from __future__ import annotations
import uuid
from typing import Any, Literal
from pydantic import BaseModel, Field

WIDGET_TYPES = {"kpi", "line", "bar", "area", "table", "progress", "list"}


class WidgetDataSource(BaseModel):
    metricId: str
    params: dict[str, Any] = Field(default_factory=dict)
    refreshSec: int | None = None


class WorkbenchWidget(BaseModel):
    id: str = Field(default_factory=lambda: f"wd-{uuid.uuid4().hex[:8]}")
    type: Literal["kpi", "line", "bar", "area", "table", "progress", "list"]
    title: str
    subtitle: str | None = None
    order: int = 0
    width: int | None = None
    height: int | None = None
    data: dict[str, Any] | None = None
    dataSource: WidgetDataSource | None = None
    options: dict[str, Any] | None = None


class HtmlTabRef(BaseModel):
    conversationId: str | int
    resourcePath: str
    pinnedAt: int


class HtmlTab(BaseModel):
    id: str = Field(default_factory=lambda: f"tab-{uuid.uuid4().hex[:8]}")
    title: str
    htmlRef: HtmlTabRef


class Dashboard(BaseModel):
    widgets: list[WorkbenchWidget] = Field(default_factory=list)


class WorkbenchConfig(BaseModel):
    dashboard: Dashboard = Field(default_factory=Dashboard)
    htmlTabs: list[HtmlTab] = Field(default_factory=list)
    tabOrder: list[str] = Field(default_factory=lambda: ["dashboard"])
    activeTabId: str | None = None
    updatedAt: int = 0


def default_config() -> WorkbenchConfig:
    return WorkbenchConfig()


def validate_widget_spec(
    spec: dict[str, Any], metric_whitelist: set[str]
) -> WorkbenchWidget:
    if spec.get("type") not in WIDGET_TYPES:
        raise ValueError(f"不支持的 widget type: {spec.get('type')}")
    # 空 dict 视为无效内联数据——内联快照必须至少含一个键(否则应改用 dataSource)
    if not spec.get("data") and not spec.get("dataSource"):
        raise ValueError("必须提供 data 或 dataSource 之一")
    src = spec.get("dataSource")
    if src and src.get("metricId") not in metric_whitelist:
        raise ValueError(f"未注册的指标: {src.get('metricId')}")
    return WorkbenchWidget(**spec)
