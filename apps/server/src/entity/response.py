"""
统一响应模型定义
用于Swagger文档展示和响应数据验证
"""
from typing import Any, Generic, TypeVar
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

T = TypeVar("T")


class ResponseBase(BaseModel, Generic[T]):
    """基础响应模型"""
    code: int = Field(default=1, description="响应状态码")
    msg: str = Field(default="操作成功", description="响应消息")
    data: T | None = Field(default=None, description="响应数据")

    @field_validator("msg", mode="before")
    @classmethod
    def set_default_msg(cls, v):
        """当msg为None时，设置默认值"""
        return "操作成功" if v is None else v

    class Config:
        json_schema_extra = {
            "example": {
                "code": 1,
                "msg": "操作成功",
                "data": None
            }
        }


class BaseResponse(BaseModel):
    """无泛型的基础响应模型"""
    code: int = Field(default=1, description="响应状态码")
    msg: str = Field(default="操作成功", description="响应消息")
    data: Any = Field(default=None, description="响应数据")

    class Config:
        json_schema_extra = {
            "example": {
                "code": 1,
                "msg": "操作成功",
                "data": None
            }
        }


class PageResponse(BaseModel, Generic[T]):
    """分页响应模型"""
    code: int = Field(default=1, description="响应状态码")
    msg: str = Field(default="操作成功", description="响应消息")
    data: T | None = Field(default=None, description="响应数据列表")
    total: int = Field(default=0, description="总记录数")
    page: int = Field(default=1, description="当前页码")
    page_size: int = Field(default=20, description="每页数量")

    @field_validator("msg", mode="before")
    @classmethod
    def set_default_msg(cls, v):
        """当msg为None时，设置默认值"""
        return "操作成功" if v is None else v

    class Config:
        json_schema_extra = {
            "example": {
                "code": 1,
                "msg": "操作成功",
                "data": [],
                "total": 0,
                "page": 1,
                "page_size": 20
            }
        }


class ListResponse(ResponseBase[list[T]], Generic[T]):
    """列表响应模型（不分页）"""
    pass


