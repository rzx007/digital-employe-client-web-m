from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

router = APIRouter(tags=["Mock工作台"])


@router.get("/my-tasks", summary="获取我的任务列表（模拟）")
def get_my_tasks(
    executor_id: str = Query(..., description="执行人ID"),
) -> dict[str, Any]:
    return {
        "code": 0,
        "msg": "success",
        "data": {
            "has_more": True,
            "page_token": "cGFnZVRva2VuOjE=",
            "total": 12,
            "items": [
                {
                    "record_id": "recveo2YREsiax",
                    "fields": {
                        "任务名称": {
                            "type": 1,
                            "value": [
                                {
                                    "type": "text",
                                    "text": "智能巡检模块-1.0.0-新产品-甘肃-MILE-4-模型能力测试",
                                }
                            ],
                        },
                        "所属项目": {
                            "type": 1,
                            "value": [
                                {
                                    "type": "text",
                                    "text": "智能巡检模块-1.0.0-新产品-甘肃",
                                }
                            ],
                        },
                        "执行人": [
                            {
                                "id": executor_id,
                                "name": "汪亮",
                                "en_name": "汪亮",
                                "email": "wangliang@bobandata.com",
                            }
                        ],
                    },
                }
            ],
        },
    }


@router.get("/product-info", summary="获取产品信息表（模拟）")
def get_product_info() -> dict[str, Any]:
    return {
        "code": 0,
        "msg": "success",
        "data": {
            "has_more": True,
            "page_token": "cGFnZVRva2VuOjE=",
            "total": 12,
            "items": [
                {
                    "record_id": "recvafnoaUYjED",
                    "fields": {
                        "License单价": 400000,
                        "产品ID【内部编号】": {
                            "type": 1,
                            "value": [
                                {
                                    "type": "text",
                                    "text": "BB-RPD-recvafnoaUYjED",
                                }
                            ],
                        },
                        "产品名称": [
                            {
                                "type": "text",
                                "text": "AI调度员-主网辅助决策",
                            }
                        ],
                        "产品描述": [
                            {
                                "type": "text",
                                "text": "电网建模+潮流推演+风险识别",
                            }
                        ],
                        "产品类别": "软件产品",
                        "归属方向": "AI调度员",
                        "当前在售版本": {
                            "type": 1,
                            "value": [
                                {
                                    "type": "text",
                                    "text": "1.0.0",
                                }
                            ],
                        },
                        "研发负责人": [
                            {
                                "id": "ou_5f48bc57c49a2b84203c8785213d60ae",
                                "name": "曹勇",
                                "en_name": "曹勇",
                                "email": "caoyong@bobandata.com",
                            }
                        ],
                    },
                }
            ],
        },
    }
