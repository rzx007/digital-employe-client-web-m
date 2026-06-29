"""工作台 widget 工具：总管向用户工作台看板添加统计块。"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from src.db.session import get_session_local
from src.service import workbench_service as ws
from src.service.agent.orchestrator.runtime import get_user_id, get_workspace_id

logger = logging.getLogger(__name__)


def _add_widget_impl(db: Session, user_id: str, spec: dict[str, Any]) -> str:
    """内联实现，便于测试直接注入 db session。"""
    try:
        widget = ws.append_widget(db, user_id, spec)
    except Exception as e:
        return f"错误：{e}"
    return f"已添加 widget「{widget.title}」(id={widget.id}) 到工作台。"


def _notify_workbench_changed() -> None:
    """推 workbench_changed 事件,让前端工作台即时 invalidate 重新拉配置。
    后端工具写库后前端无从感知,不推事件则新 widget 要刷新页面才出现。"""
    try:
        from src.service.workspace_events import WorkspaceEventBus

        WorkspaceEventBus.push(get_workspace_id(), {"type": "workbench_changed"})
    except Exception:
        logger.debug("workbench_changed 事件推送失败", exc_info=True)


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

    type 取值: kpi|line|bar|area|pie|table|progress|list|gauge|sparkline|radar|scatter。
    data 与 data_source 至少给一个：data 为内联快照；data_source={"metricId": "...","params":{...}} 绑定实时指标。
    可用 metricId(均按当前工作空间实时取数):
      monthly_performance(配 kpi)、task_calendar(配 table)、today_tasks(配 list)、
      task_execution_stats(今日成功/失败/进行中/成功率,配 kpi)、
      employee_overview(在职员工/近7天新增,配 kpi)、
      plan_progress(编排计划 待确认/进行中/已完成/已取消,配 kpi)、
      skill_usage(技能总数/内置/工作区,配 kpi)、
      workspace_file(读工作空间内 JSON 文件当数据,配任意 type)。
      绑定示例: data_source={"metricId":"task_execution_stats","refreshSec":30}。
      workspace_file 用法: data_source={"metricId":"workspace_file",
        "params":{"path":"wc-today.json"},"refreshSec":600}——path 相对工作空间根(可子目录),
        文件内容须是该 widget type 的 data 形状(如 table→{columns,rows});适合"定时任务写
        文件→看板自动刷"的场景,widget 只建一次、数据与展示解耦。

    内联 data 必须严格按对应 type 的形状(否则前端渲染为空):
      kpi:      {"items": [{"label": "本月销售", "value": 1234, "unit": "¥",
                            "delta": "+5%", "deltaDir": "up|down|flat"}]}
      line/bar/area: {"xKey": "date",
                      "series": [{"key": "sales", "label": "销售额"}],
                      "rows": [{"date": "周一", "sales": 120}, {"date": "周二", "sales": 90}]}
                     (rows 是对象数组,每行含 xKey 和各 series.key 字段)
      pie:      {"items": [{"name": "直接访问", "value": 38},
                           {"name": "搜索引擎", "value": 27}]}  —— options:{"donut":true} 可切环形
      table:    {"columns": [{"key": "name", "label": "姓名"}],
                 "rows": [{"name": "张三"}]}  —— 推荐对象列+对象行;
                也接受简易式 {"columns": ["姓名","分数"], "rows": [["张三", 95]]}(字符串列+数组行)
      progress: {"items": [{"label": "目标完成度", "value": 75, "max": 100}]}
      list:     {"items": [{"title": "待办A", "value": "进行中", "badge": "高"}]}
      gauge:    {"value": 72, "max": 100, "label": "完成度", "unit": ""}  —— 单值对目标的环形仪表
      sparkline:{"label": "本周访问", "value": 1280, "unit": "", "delta": "+8%",
                 "deltaDir": "up", "points": [5,7,6,9,8,11,12]}  —— 大数字+迷你趋势线
      radar:    {"axisKey": "axis",
                 "rows": [{"axis": "速度", "A": 80}, {"axis": "精度", "A": 90}],
                 "series": [{"key": "A", "label": "模型A"}]}  —— 多维对比
      scatter:  {"points": [{"x": 1, "y": 2}, {"x": 3, "y": 5}],
                 "xLabel": "价格", "yLabel": "销量"}  —— 也支持 series:[{name,points:[{x,y}]}] 多组
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
        msg = _add_widget_impl(db, user_id, spec)
    finally:
        db.close()
    if msg.startswith("已添加"):
        _notify_workbench_changed()
    return msg
