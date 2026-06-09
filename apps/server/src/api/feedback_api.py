from typing import Any

from fastapi import APIRouter, Body, Depends, Request

from src.core.deps import require_capability
from src.service import feedback_service

router = APIRouter(tags=["反馈"])


@router.post(
    "/feedback",
    summary="提交 BUG 反馈（转发远端）",
    response_model=dict[str, Any],
    dependencies=[Depends(require_capability("remote_feedback"))],
)
def submit_feedback_endpoint(request: Request, body: dict[str, Any] = Body(...)):
    """前端反馈表单直接提交到此（含可选截图 base64）；服务端补 env/日志后转发远端。"""
    token = (request.headers.get("token") or "").strip() or None
    payload = feedback_service.assemble_payload(body)
    return feedback_service.submit_feedback(payload, token=token)
