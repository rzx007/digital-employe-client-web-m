from typing import Any
from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.core.request_utils import get_user_id
from src.models.workbench_config import WorkbenchConfig
from src.service import workbench_service as ws
from src.service.workbench_metrics import resolve_metric, metric_ids

router = APIRouter(tags=["工作台"])


@router.get("/workbench")
def get_workbench(request: Request, db: Session = Depends(get_db)) -> WorkbenchConfig:
    return ws.load_config(db, get_user_id(request))


@router.put("/workbench")
def put_workbench(payload: WorkbenchConfig, request: Request, db: Session = Depends(get_db)) -> WorkbenchConfig:
    ws.save_config(db, get_user_id(request), payload)
    return payload


@router.post("/workbench/metrics/{metric_id}/resolve")
async def resolve(metric_id: str, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    if metric_id not in metric_ids():
        raise HTTPException(status_code=404, detail="指标不存在")
    try:
        params = await request.json()
    except Exception:
        params = {}
    if not isinstance(params, dict):
        params = {}
    params.setdefault("user_id", get_user_id(request))
    return await resolve_metric(db, metric_id, params)
