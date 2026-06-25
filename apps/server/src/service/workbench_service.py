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
