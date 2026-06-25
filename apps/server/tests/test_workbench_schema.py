from typing import get_args

import pytest
from src.models.workbench_config import (
    WIDGET_TYPES, WorkbenchWidget, validate_widget_spec, WorkbenchConfig, default_config,
)

def test_widget_types_catalog():
    assert WIDGET_TYPES == {"kpi", "line", "bar", "area", "table", "progress", "list"}

def test_widget_types_matches_literal():
    # 锁定 WIDGET_TYPES 与 WorkbenchWidget.type 的 Literal 同步,防止将来漏改一处
    literal_types = set(get_args(WorkbenchWidget.model_fields["type"].annotation))
    assert WIDGET_TYPES == literal_types

def test_reject_empty_inline_data():
    # 空 dict 的内联 data 视为无效,必须改用 dataSource 或提供非空 data
    with pytest.raises(ValueError, match="data 或 dataSource"):
        validate_widget_spec({"type": "kpi", "title": "x", "data": {}}, metric_whitelist=set())

def test_valid_inline_widget():
    spec = {"type": "kpi", "title": "本月销售", "data": {"items": []}}
    w = validate_widget_spec(spec, metric_whitelist={"monthly_performance"})
    assert w.type == "kpi" and w.id  # id 自动生成

def test_valid_datasource_widget():
    spec = {"type": "line", "title": "趋势", "dataSource": {"metricId": "monthly_performance"}}
    w = validate_widget_spec(spec, metric_whitelist={"monthly_performance"})
    assert w.dataSource.metricId == "monthly_performance"

def test_reject_unknown_type():
    with pytest.raises(ValueError, match="不支持的 widget type"):
        validate_widget_spec({"type": "pie", "title": "x", "data": {}}, metric_whitelist=set())

def test_reject_no_data_and_no_source():
    with pytest.raises(ValueError, match="data 或 dataSource"):
        validate_widget_spec({"type": "kpi", "title": "x"}, metric_whitelist=set())

def test_reject_unknown_metric():
    with pytest.raises(ValueError, match="未注册的指标"):
        validate_widget_spec(
            {"type": "kpi", "title": "x", "dataSource": {"metricId": "ghost"}},
            metric_whitelist={"monthly_performance"},
        )


def test_reject_kpi_flat_shape():
    # 扁平 data(无 items)是模型最常见的误写,会渲染空白——必须在生成时拒掉
    with pytest.raises(ValueError, match="items"):
        validate_widget_spec(
            {
                "type": "kpi",
                "title": "今日任务",
                "data": {"value": 8, "target": 10, "unit": "个", "prefix": "已完成"},
            },
            metric_whitelist=set(),
        )


def test_reject_kpi_items_not_list():
    with pytest.raises(ValueError, match="数组"):
        validate_widget_spec(
            {"type": "kpi", "title": "x", "data": {"items": {"value": 1}}},
            metric_whitelist=set(),
        )


def test_reject_chart_missing_rows():
    with pytest.raises(ValueError, match="rows"):
        validate_widget_spec(
            {"type": "line", "title": "趋势", "data": {"series": [{"key": "s"}]}},
            metric_whitelist=set(),
        )


def test_reject_table_missing_columns():
    with pytest.raises(ValueError, match="columns"):
        validate_widget_spec(
            {"type": "table", "title": "表", "data": {"rows": [{"name": "张三"}]}},
            metric_whitelist=set(),
        )


def test_accept_empty_items_list():
    # 形状对、只是空 → 合法(沿用既有意图,空态前端优雅降级)
    w = validate_widget_spec(
        {"type": "kpi", "title": "x", "data": {"items": []}},
        metric_whitelist=set(),
    )
    assert w.type == "kpi"


def test_accept_valid_chart_shape():
    w = validate_widget_spec(
        {
            "type": "bar",
            "title": "趋势",
            "data": {
                "xKey": "date",
                "series": [{"key": "sales", "label": "销售额"}],
                "rows": [{"date": "周一", "sales": 120}],
            },
        },
        metric_whitelist=set(),
    )
    assert w.type == "bar"


def test_datasource_skips_inline_shape_check():
    # 走 dataSource 时 data 由指标运行时填充,不校验内联形状
    w = validate_widget_spec(
        {"type": "kpi", "title": "x", "dataSource": {"metricId": "monthly_performance"}},
        metric_whitelist={"monthly_performance"},
    )
    assert w.dataSource.metricId == "monthly_performance"

def test_default_config_shape():
    cfg = default_config()
    assert cfg.dashboard.widgets == [] and cfg.htmlTabs == []
    assert cfg.tabOrder == ["dashboard"]
