import pytest
from src.models.workbench_config import (
    WIDGET_TYPES, validate_widget_spec, WorkbenchConfig, default_config,
)

def test_widget_types_catalog():
    assert WIDGET_TYPES == {"kpi", "line", "bar", "area", "table", "progress", "list"}

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

def test_default_config_shape():
    cfg = default_config()
    assert cfg.dashboard.widgets == [] and cfg.htmlTabs == []
    assert cfg.tabOrder == ["dashboard"]
