from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column
from src.db.base import Base
from src.db.types import CstDateTime
from src.core.cst import cst_now

WIDGET_TYPES = {"kpi", "line", "bar", "area", "pie", "table", "progress", "list"}

# 每个 type 的内联 data 必需的数组字段(对齐 add_workbench_widget 文档契约)。
# 提供内联 data 时这些键必须存在且为 list,否则前端按契约渲染成空白。
# 模型最常见的误写是把 kpi 写成扁平 {value,target,unit,prefix}——无 items → 空白。
INLINE_DATA_REQUIRED_KEYS: dict[str, tuple[str, ...]] = {
    "kpi": ("items",),
    "progress": ("items",),
    "list": ("items",),
    "line": ("series", "rows"),
    "bar": ("series", "rows"),
    "area": ("series", "rows"),
    "table": ("columns", "rows"),
}


class WidgetDataSource(BaseModel):
    metricId: str
    params: dict[str, Any] = Field(default_factory=dict)
    refreshSec: int | None = None


class WorkbenchWidget(BaseModel):
    id: str = Field(default_factory=lambda: f"wd-{uuid.uuid4().hex[:8]}")
    type: Literal[
        "kpi", "line", "bar", "area", "pie", "table", "progress", "list"
    ]
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


class WorkbenchConfigRow(Base):
    __tablename__ = "workbench_configs"
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        CstDateTime, default=cst_now, onupdate=cst_now
    )


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
    _validate_inline_data_shape(spec)
    return WorkbenchWidget(**spec)


def _validate_inline_data_shape(spec: dict[str, Any]) -> None:
    """提供内联 data 时,按 type 校验必需的数组字段存在,避免形状错导致前端渲染空白。

    走 dataSource(无内联 data)时跳过——data 由指标运行时填充。
    形状对、内容空(如 items=[])视为合法,只拒形状错(缺键 / 非数组)。
    """
    data = spec.get("data")
    if not data:
        return
    required = INLINE_DATA_REQUIRED_KEYS.get(spec["type"], ())
    for key in required:
        if key not in data:
            raise ValueError(
                f"{spec['type']} 的内联 data 缺少必需字段「{key}」(须为数组)；"
                f"收到的键: {sorted(data.keys())}。"
                f"正确形状见 add_workbench_widget 文档,例如 kpi: "
                f'{{"items": [{{"label": "已完成", "value": 8, "unit": "个"}}]}}'
            )
        if not isinstance(data[key], list):
            raise ValueError(
                f"{spec['type']} 的 data.{key} 必须是数组,收到 {type(data[key]).__name__}"
            )
