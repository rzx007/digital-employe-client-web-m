from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_serializer


class PerformanceRecordRead(BaseModel):
    id: int
    assessment_period: str = Field(..., description="考核周期，格式 YYYY-MM")
    username: str = Field(..., description="用户名")
    work_no: str = Field(..., description="工号")
    department: str = Field(..., description="所属部门")
    position_title: str = Field(..., description="岗位职务")
    monthly_ac_total: float = Field(..., description="当月AC总值")
    monthly_ev_total: float = Field(..., description="当月EV总值")
    monthly_work_deviation: float = Field(..., description="当月工作偏差")
    ac_actual_base_value: float = Field(..., description="AC实发基准值")
    workday_base_deviation: float = Field(..., description="工作日基准偏差")
    assessment_department: str = Field(..., description="考核部门")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")
