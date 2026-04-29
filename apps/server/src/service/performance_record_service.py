from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.config_kv import ConfigKv
from src.models.performance_record import PerformanceRecord


class PerformanceRecordService:
    @staticmethod
    def _get_username_from_config(db: Session) -> str:
        username = db.scalar(
            select(ConfigKv.config_value).where(ConfigKv.config_key == "USERNAME")
        )
        normalized = str(username or "").strip()
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到配置 username，请先在 config_kvs 表配置 key=username。",
            )
        return normalized

    @staticmethod
    def get_current_month_records_by_username(db: Session) -> list[PerformanceRecord]:
        username = PerformanceRecordService._get_username_from_config(db)
        current_period = datetime.now().strftime("%Y-%m")
        return list(
            db.scalars(
                select(PerformanceRecord)
                .where(PerformanceRecord.assessment_period == current_period)
                .where(PerformanceRecord.username == username)
                .order_by(PerformanceRecord.id.desc())
            ).all()
        )
