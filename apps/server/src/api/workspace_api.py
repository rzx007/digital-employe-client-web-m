from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.workspace import FileEntry, WorkspaceCreate, WorkspaceRead, WorkspaceUpdate
from src.service.chat_service import ChatService
from src.service.file_service import FileService
from src.service.workspace_events import WorkspaceEventBus
from src.service.workspace_service import WorkspaceService


class ChatSendRequest(BaseModel):
    question: str
    employee_id: int
    skill_descriptions: str | None = None

router = APIRouter(tags=["工作空间"])
logger = logging.getLogger(__name__)


@router.post("/workspaces/create", response_model=ResponseBase[WorkspaceRead], status_code=status.HTTP_201_CREATED)
def create_workspace(workspace_create: WorkspaceCreate, db: Session = Depends(get_db)) -> ResponseBase[WorkspaceRead]:
    """创建工作空间。"""
    return ResponseBase(data=WorkspaceService.create_workspace(workspace_create, db))


@router.get("/workspaces/list", response_model=ListResponse[WorkspaceRead])
def list_workspaces(db: Session = Depends(get_db)) -> ListResponse[WorkspaceRead]:
    """查询工作空间列表。"""
    return ListResponse(data=WorkspaceService.list_workspaces(db))


@router.get("/workspaces/detail/{workspace_id}", response_model=ResponseBase[WorkspaceRead])
def get_workspace(workspace_id: int, db: Session = Depends(get_db)) -> ResponseBase[WorkspaceRead]:
    """根据工作空间ID查询详情。"""
    return ResponseBase(data=WorkspaceService.get_workspace(db, workspace_id))


@router.put("/workspaces/update/{workspace_id}", response_model=ResponseBase[WorkspaceRead])
def update_workspace(
    workspace_id: int,
    payload: WorkspaceUpdate,
    db: Session = Depends(get_db),
) -> ResponseBase[WorkspaceRead]:
    """更新指定工作空间信息。"""
    return ResponseBase(data=WorkspaceService.update_workspace(db, workspace_id, payload))


@router.delete("/workspaces/delete/{workspace_id}", status_code=status.HTTP_200_OK, response_model=BaseResponse)
def delete_workspace(workspace_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """删除指定工作空间。"""
    WorkspaceService.delete_workspace(db, workspace_id)
    return BaseResponse(data=None)


@router.get("/workspaces/files/{workspace_id}", response_model=ListResponse[FileEntry])
def list_workspace_files(
    workspace_id: int,
    recursive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> ListResponse[FileEntry]:
    """查询工作空间文件列表，可选递归返回子目录。"""
    workspace = WorkspaceService.get_workspace(db, workspace_id)
    return ListResponse(data=FileService.list_entries(workspace.root_path, recursive=recursive))


class ChatSendResponse(BaseModel):
    response: str


@router.post("/workspaces/{workspace_id}/chat/send", response_model=ResponseBase[ChatSendResponse])
async def chat_send(
    workspace_id: int,
    payload: ChatSendRequest,
    db: Session = Depends(get_db),
) -> ResponseBase[ChatSendResponse]:
    """发送聊天消息并获取AI响应（非流式）。"""
    from src.service.agent import get_agent
    from src.models.employee import Employee

    workspace = WorkspaceService.get_workspace(db, workspace_id)
    employee = db.get(Employee, payload.employee_id)
    if not employee:
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工")

    skills_path_payload = employee.skills_json
    try:
        skills_path = ChatService.resolve_employee_skills_dir(
            skills_payload=skills_path_payload,
            employee_id=employee.id,
            employee_name=employee.name,
            employee_code=employee.employee_code,
        )
    except Exception as exc:
        logger.error("解析员工技能目录失败 employee_id=%s: %s", employee.id, exc, exc_info=True)
        skills_path = ""

    agent = get_agent(skills_path, workspace.root_path, employee_id=employee.id)

    # Collect the full response from the agent
    collected_texts: list[str] = []
    try:
        async for chunk in agent.astream(
            {"messages": [{"role": "user", "content": payload.question}]},
            stream_mode="messages",
            config={"configurable": {"thread_id": f"chat-send-{payload.employee_id}"}},
        ):
            # When stream_mode="messages", chunk is a tuple (message_chunk, metadata)
            if isinstance(chunk, tuple):
                message_chunk = chunk[0]
            else:
                message_chunk = chunk
            # AIMessageChunk has a content attribute that is a string
            if hasattr(message_chunk, "content") and isinstance(message_chunk.content, str):
                collected_texts.append(message_chunk.content)
    except Exception as e:
        logger.error("chat astream 异常: %s", e, exc_info=True)

    full_response = "".join(collected_texts).strip()
    return ResponseBase(data=ChatSendResponse(response=full_response or "模型已完成调用。"))


@router.get("/workspaces/{workspace_id}/events")
async def workspace_events(
    workspace_id: int,
) -> StreamingResponse:
    """工作空间级 SSE 事件通道，推送任务启动/完成/失败通知。"""

    async def event_generator():
        queue = WorkspaceEventBus.subscribe(workspace_id)
        try:
            while True:
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            WorkspaceEventBus.unsubscribe(workspace_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )

