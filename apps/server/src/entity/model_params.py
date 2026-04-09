"""
模型参数实体类定义
用于替代字典类型的模型参数
"""
from typing import Optional
from pydantic import BaseModel, Field


class ModelParams(BaseModel):
    """模型参数实体类"""
    model: Optional[str] = Field(default="qwen2.5-72b-instruct", description="模型名称")
    temperature: Optional[float] = Field(default=0.7, description="温度参数，控制输出随机性")
    max_tokens: Optional[int] = Field(default=None, description="最大生成token数")
    top_p: Optional[float] = Field(default=1.0, description="top_p参数，控制核采样")
    frequency_penalty: Optional[float] = Field(default=0.0, description="频率惩罚度")
    presence_penalty: Optional[float] = Field(default=0.0, description="存在惩罚度")
    
    class Config:
        json_schema_extra = {
            "example": {
                "model": "qwen2.5-72b-instruct",
                "temperature": 0.7,
                "max_tokens": None,
                "top_p": 1.0,
                "frequency_penalty": 0.0,
                "presence_penalty": 0.0
            }
        }