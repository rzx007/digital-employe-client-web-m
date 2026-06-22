from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import ListResponse, ResponseBase
from src.models.workbench_resource import WorkbenchResource
from src.schemas.workbench_resource import (
    WorkbenchResourceAddArtifact,
    WorkbenchResourceRead,
)
from src.service.workbench_resource_service import WorkbenchResourceService
from src.service.workspace_service import WorkspaceService

router = APIRouter(tags=["工作台资源池"])
logger = logging.getLogger(__name__)

MAX_HTML_BYTES = 10 * 1024 * 1024  # 10MB


@router.get(
    "/workbench-resources/list",
    response_model=ListResponse[WorkbenchResourceRead],
)
def list_workbench_resources(
    workspace_id: int = Query(...), db: Session = Depends(get_db)
) -> ListResponse[WorkbenchResourceRead]:
    rows = WorkbenchResourceService.list_resources(db, workspace_id)
    return ListResponse(data=[WorkbenchResourceRead.model_validate(r) for r in rows])


@router.post(
    "/workbench-resources/add",
    response_model=ResponseBase[WorkbenchResourceRead],
)
def add_workbench_resource(
    payload: WorkbenchResourceAddArtifact, db: Session = Depends(get_db)
) -> ResponseBase[WorkbenchResourceRead]:
    row = WorkbenchResourceService.add_artifact(
        db,
        workspace_id=payload.workspace_id,
        src_path=payload.src_path,
        title=payload.title,
        added_by=None,
    )
    return ResponseBase(data=WorkbenchResourceRead.model_validate(row))


@router.post(
    "/workbench-resources/upload",
    response_model=ResponseBase[WorkbenchResourceRead],
)
async def upload_workbench_resource(
    workspace_id: int = Form(...),
    title: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ResponseBase[WorkbenchResourceRead]:
    name = file.filename or "upload.html"
    if not name.lower().endswith((".html", ".htm")):
        raise HTTPException(status_code=400, detail="只接受 .html/.htm 文件")
    content = await file.read()
    if len(content) > MAX_HTML_BYTES:
        raise HTTPException(status_code=400, detail="文件超过 10MB 上限")
    if not content:
        raise HTTPException(status_code=400, detail="文件为空")

    ws = WorkspaceService.get_workspace(db, workspace_id)
    rel_dir = Path("workbench-uploads") / uuid.uuid4().hex
    abs_dir = Path(ws.root_path) / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)
    (abs_dir / name).write_bytes(content)
    rel_path = (rel_dir / name).as_posix()

    row = WorkbenchResourceService.add_upload(
        db,
        workspace_id=workspace_id,
        src_path=rel_path,
        title=title,
        added_by=None,
    )
    return ResponseBase(data=WorkbenchResourceRead.model_validate(row))


@router.get(
    "/workbench-resources/{resource_id}/content",
    response_model=ResponseBase[dict],
)
def read_workbench_resource_content(
    resource_id: int,
    workspace_id: int = Query(...),
    db: Session = Depends(get_db),
) -> ResponseBase[dict]:
    """读资源池条目的 HTML 内容（按 resource_id，后端解析 root_path+src_path 绝对路径）。

    资源池看板渲染走这里——不借 conversationId，因为资源是 workspace 级、跨会话复用。
    """
    data = WorkbenchResourceService.read_html_content(db, workspace_id, resource_id)
    return ResponseBase(data=data)


@router.delete(
    "/workbench-resources/{resource_id}",
    response_model=ResponseBase[dict],
)
def delete_workbench_resource(
    resource_id: int,
    workspace_id: int = Query(...),
    db: Session = Depends(get_db),
) -> ResponseBase[dict]:
    # upload 来源同时删物理文件；employee_artifact 来源仅删登记。
    row = db.get(WorkbenchResource, resource_id)
    if row is not None and row.workspace_id == workspace_id and row.source == "upload":
        try:
            ws = WorkspaceService.get_workspace(db, workspace_id)
            fp = Path(ws.root_path) / row.src_path
            if fp.is_file():
                fp.unlink()
        except Exception as exc:  # 物理删除失败不阻塞登记删除
            logger.warning("删除上传文件失败 %s: %s", row.src_path if row else "?", exc)
    WorkbenchResourceService.delete_resource(db, workspace_id, resource_id)
    return ResponseBase(data={"deleted": resource_id})
