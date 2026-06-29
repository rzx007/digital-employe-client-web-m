from __future__ import annotations
from typing import Any
from sqlalchemy.orm import Session
from src.models.workbench_config import (
    WorkbenchConfig, WorkbenchConfigRow, default_config, validate_widget_spec,
)
from src.service.workbench_metrics import metric_ids


def load_config(db: Session, user_id: str) -> WorkbenchConfig:
    row = db.get(WorkbenchConfigRow, user_id)
    if not row:
        return default_config()
    return WorkbenchConfig.model_validate_json(row.config_json)


def save_config(db: Session, user_id: str, cfg: WorkbenchConfig) -> None:
    row = db.get(WorkbenchConfigRow, user_id)
    if not row:
        row = WorkbenchConfigRow(user_id=user_id)
        db.add(row)
    row.config_json = cfg.model_dump_json()
    db.commit()


def append_widget(db: Session, user_id: str, spec: dict[str, Any]):
    widget = validate_widget_spec(spec, metric_whitelist=metric_ids())
    cfg = load_config(db, user_id)
    widget.order = len(cfg.dashboard.widgets)
    cfg.dashboard.widgets.append(widget)
    save_config(db, user_id, cfg)
    return widget


def upsert_widget(
    db: Session, user_id: str, spec: dict[str, Any], key: str | None = None
):
    """有 key 且已存在同 key widget → 原地更新;否则新建。返回 (widget, created: bool)。
    定时任务用固定 key 反复调用即幂等(不会重复建卡、不用记自动 id)。"""
    if key:
        cfg = load_config(db, user_id)
        existing = next(
            (w for w in cfg.dashboard.widgets if w.key == key), None
        )
        if existing is not None:
            return update_widget(db, user_id, existing.id, {**spec, "key": key}), False
    full = {**spec, "key": key} if key else dict(spec)
    return append_widget(db, user_id, full), True


def list_widgets(db: Session, user_id: str):
    """返回当前用户 dashboard 的 widget 列表(只读)。"""
    return load_config(db, user_id).dashboard.widgets


def update_widget(db: Session, user_id: str, widget_id: str, patch: dict[str, Any]):
    """按 id 原地更新一个 widget,只改 patch 里给的字段。
    id/order 保持不变;合并后整体过 validate_widget_spec 重新校验。未找到则抛 ValueError。"""
    cfg = load_config(db, user_id)
    widgets = cfg.dashboard.widgets
    idx = next((i for i, w in enumerate(widgets) if w.id == widget_id), None)
    if idx is None:
        raise ValueError(f"未找到 widget: {widget_id}")
    current = widgets[idx]
    merged = current.model_dump()
    for key, val in patch.items():
        if val is not None:
            merged[key] = val
    merged["id"] = widget_id  # id 不可被 patch 改
    validated = validate_widget_spec(merged, metric_whitelist=metric_ids())
    validated.id = widget_id
    validated.order = current.order  # 保持原有顺序
    widgets[idx] = validated
    save_config(db, user_id, cfg)
    return validated
