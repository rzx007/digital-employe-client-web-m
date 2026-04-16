from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, List, Dict

from pydantic import BaseModel, Field, field_serializer, model_validator


class ShiftScheduleCreateWithoutEmployee(BaseModel):
    """创建排班计划（不含员工ID，用于嵌套在员工信息中）"""
    start_date: Optional[str] = Field(None, description="开始日期，可为空")
    end_date: Optional[str] = Field(None, description="结束日期，可为空")
    status: int = Field(1, description="排班状态: 1-激活, 2-未激活, 3-取消")
    notes: Optional[str] = Field(None, description="备注")


class SchedulingTaskCreateWithoutEmployee(BaseModel):
    """创建调度任务（不含员工ID，用于嵌套在员工信息中）"""
    id: Optional[int] = None
    task_name: str
    dispatch_type: str = "skill"
    task_resource_type: Optional[str] = None
    skill_id: Optional[int] = None
    capability_id: Optional[int] = None
    mcp_tool_name: Optional[str] = None
    user_prompt: Optional[str] = None
    priority: int = 0
    task_type: int  # 1: 外部输入, 2: Cron任务
    config: Dict[str, Any]
    cron_expression: Optional[str] = None
    cron_expression_type: Optional[str] = None
    is_active: Optional[bool] = True
    confirm_execution_result: bool = Field(
        False,
        description="为 true 时表示需在定时任务执行后确认执行结果",
    )

    @model_validator(mode="before")
    @classmethod
    def map_task_resource_type(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        trt = data.get("task_resource_type")
        if trt is None or not str(trt).strip():
            return data
        low = str(trt).strip().lower()
        if low == "mcp":
            return {**data, "dispatch_type": "mcp"}
        if low == "skill":
            return {**data, "dispatch_type": "skill"}
        return data

class EmployeeBase(BaseModel):
    """员工基础信息"""

    workspace_id: Optional[int] = None
    employee_name: str
    capability_desc: Optional[str] = None
    status: int = 1
    detail_page_url: Optional[str] = None

class EmployeeRead(BaseModel):
    id: int
    workspace_id: int
    employee_code: str
    name: str | None
    description: str | None
    version: str | None
    skills: list[dict[str, Any]]
    metadata: dict[str, Any]
    shift_schedule: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")


class EmployeeUpdate(EmployeeBase):
    skill_ids: Optional[List[int]] = None
    mcp_ids: Optional[List[int]] = None
    shift_schedule: Optional[ShiftScheduleCreateWithoutEmployee] = None
    tasks: Optional[List[SchedulingTaskCreateWithoutEmployee]] = None


class EmployeeSyncResult(BaseModel):
    workspace_id: int
    synced_count: int
    employees: list[EmployeeRead]


class EmployeeCreate(EmployeeBase):
    """创建员工信息"""

    # 添加技能列表
    skill_ids: Optional[List[int]] = None
    # 添加 MCP 列表
    mcp_ids: Optional[List[int]] = None
    # 添加排班信息 - 使用具体的模型而不是字典
    shift_schedule: Optional[ShiftScheduleCreateWithoutEmployee] = None
    # 添加任务信息 - 使用具体的模型而不是字典
    tasks: Optional[List[SchedulingTaskCreateWithoutEmployee]] = None
    user_id: Optional[str] = None

class EmployeeOut(EmployeeBase):
    """员工输出信息"""

    id: int
    created_at: str
    updated_at: str
    user_id: Optional[str] = None
    skill_ids: List[int]
    mcp_ids: Optional[List[int]] = None
    skills: Optional[List[dict]] = None
    shift_schedule: Optional[ShiftScheduleCreateWithoutEmployee] = None
    tasks: Optional[List[SchedulingTaskCreateWithoutEmployee]] = None


class EmployeeGenerationRequest(BaseModel):
    prompt: str
    count: int = 1

class EmployeeProfile(BaseModel):
    name: str
    description: str
    skill_ids: list[int] = Field(default_factory=list)
    skills_list: list[dict[str, Any]] = Field(default_factory=list)