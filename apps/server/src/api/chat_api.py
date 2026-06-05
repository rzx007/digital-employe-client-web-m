from __future__ import annotations

import mimetypes

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.conversation import (
    ApproveRequest,
    ConversationCreate,
    ConversationMessageRead,
    ConversationRead,
    ConversationUpdate,
    ConversationsBulkDeleteResult,
    StreamConversationRequest,
)
from src.schemas.recent_contact import (
    RecentContactImportRequest,
    RecentContactPinUpdate,
    RecentContactRead,
    RecentContactTouch,
)
from src.schemas.resource import ResourceContent, ResourceList, ResourceUploadResult
from src.service.chat_service import ChatService
from src.service.recent_contact_service import RecentContactService
from src.service.resource_service import ResourceService

router = APIRouter(tags=["对话"])


@router.get(
    "/workspaces/{workspace_id}/chat/curator/conversation",
    response_model=ResponseBase[ConversationRead],
)
def get_curator_conversation(
    workspace_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[ConversationRead]:
    """获取或创建总管对话（每个 workspace 仅一条）。"""
    conversation = ChatService.ensure_curator_conversation(db, workspace_id)
    return ResponseBase(data=conversation)


@router.post(
    "/workspaces/{workspace_id}/chat/conversations",
    response_model=ResponseBase[ConversationRead],
)
def create_conversation(
    workspace_id: int,
    payload: ConversationCreate,
    db: Session = Depends(get_db),
) -> ResponseBase[ConversationRead]:
    """创建会话。"""
    conversation = ChatService.create_conversation(
        db=db,
        workspace_id=workspace_id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        title=payload.title,
    )
    return ResponseBase(data=conversation)


@router.get(
    "/workspaces/{workspace_id}/chat/conversations",
    response_model=ListResponse[ConversationRead],
)
def list_conversations(
    workspace_id: int,
    target_type: str = Query(...),
    target_id: int = Query(...),
    db: Session = Depends(get_db),
) -> ListResponse[ConversationRead]:
    """按目标对象查询会话列表。"""
    conversations = ChatService.list_conversations(
        db=db,
        workspace_id=workspace_id,
        target_type=target_type,
        target_id=target_id,
    )
    return ListResponse(data=conversations)


@router.get(
    "/workspaces/{workspace_id}/chat/recent-contacts",
    response_model=ListResponse[RecentContactRead],
)
def list_recent_contacts(
    workspace_id: int,
    db: Session = Depends(get_db),
) -> ListResponse[RecentContactRead]:
    """工作空间最近联系人侧栏列表。"""
    items = RecentContactService.list_recent_contacts(db, workspace_id)
    return ListResponse(data=items)


@router.put(
    "/workspaces/{workspace_id}/chat/recent-contacts",
    response_model=ResponseBase[RecentContactRead],
)
def touch_recent_contact(
    workspace_id: int,
    payload: RecentContactTouch,
    db: Session = Depends(get_db),
) -> ResponseBase[RecentContactRead]:
    """选中联系人时 upsert 并更新最近访问时间。"""
    item = RecentContactService.touch(
        db=db,
        workspace_id=workspace_id,
        target_type=payload.target_type,
        target_id=payload.target_id,
    )
    return ResponseBase(data=item)


@router.patch(
    "/workspaces/{workspace_id}/chat/recent-contacts/{target_type}/{target_id}",
    response_model=ResponseBase[RecentContactRead],
)
def update_recent_contact_pin(
    workspace_id: int,
    target_type: str,
    target_id: int,
    payload: RecentContactPinUpdate,
    db: Session = Depends(get_db),
) -> ResponseBase[RecentContactRead]:
    """更新最近联系人置顶状态。"""
    item = RecentContactService.set_pinned(
        db=db,
        workspace_id=workspace_id,
        target_type=target_type,
        target_id=target_id,
        is_pinned=payload.is_pinned,
    )
    return ResponseBase(data=item)


@router.delete(
    "/workspaces/{workspace_id}/chat/recent-contacts/{target_type}/{target_id}",
    response_model=BaseResponse,
    status_code=status.HTTP_200_OK,
)
def delete_recent_contact(
    workspace_id: int,
    target_type: str,
    target_id: int,
    db: Session = Depends(get_db),
) -> BaseResponse:
    """从侧栏移除最近联系人（不删除会话）。"""
    RecentContactService.delete_by_target(
        db=db,
        workspace_id=workspace_id,
        target_type=target_type,
        target_id=target_id,
    )
    return BaseResponse(data=None)


@router.post(
    "/workspaces/{workspace_id}/chat/recent-contacts/import",
    response_model=ResponseBase[dict],
)
def import_recent_contacts(
    workspace_id: int,
    payload: RecentContactImportRequest,
    db: Session = Depends(get_db),
) -> ResponseBase[dict]:
    """从客户端 localStorage 一次性导入最近联系人。"""
    count = RecentContactService.import_items(
        db=db,
        workspace_id=workspace_id,
        items=payload.items,
    )
    return ResponseBase(data={"imported_count": count})


@router.delete(
    "/workspaces/{workspace_id}/chat/conversations",
    response_model=ResponseBase[ConversationsBulkDeleteResult],
    status_code=status.HTTP_200_OK,
)
async def delete_conversations_by_target(
    workspace_id: int,
    target_type: str = Query(...),
    target_id: int = Query(...),
    db: Session = Depends(get_db),
) -> ResponseBase[ConversationsBulkDeleteResult]:
    """按联系人（target_type + target_id）批量删除其下全部会话。"""
    deleted_ids = await ChatService.adelete_conversations_by_target(
        db=db,
        workspace_id=workspace_id,
        target_type=target_type,
        target_id=target_id,
    )
    return ResponseBase(
        data=ConversationsBulkDeleteResult(
            deleted_count=len(deleted_ids),
            deleted_ids=deleted_ids,
        )
    )


@router.get("/chat/conversations/{conversation_id}/messages", response_model=ListResponse[ConversationMessageRead])
def list_conversation_messages(conversation_id: int, db: Session = Depends(get_db)) -> ListResponse[ConversationMessageRead]:
    """查询指定会话下的消息列表。"""
    from src.models.conversation import Conversation
    from src.service.orchestrator_execution_summary import (
        backfill_missing_orchestrator_summaries,
    )

    conv = db.get(Conversation, conversation_id)
    if conv and conv.target_type == "curator":
        backfill_missing_orchestrator_summaries(
            db, conv.workspace_id, conversation_id, limit=20
        )
    messages = ChatService.list_messages(db, conversation_id)
    return ListResponse[ConversationMessageRead](data=messages)


@router.get(
    "/chat/conversations/{conversation_id}/context-budget",
    response_model=ResponseBase,
)
def get_conversation_context_budget(
    conversation_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase:
    """返回会话上下文用量与压缩阈值进度（供 Chat UI 展示）。"""
    from src.service.context_budget import (
        ContextBudgetRead,
        resolve_context_budget_for_conversation,
    )

    data = resolve_context_budget_for_conversation(db, conversation_id)
    return ResponseBase[ContextBudgetRead](data=data)


@router.patch(
    "/chat/conversations/{conversation_id}",
    response_model=ResponseBase[ConversationRead],
)
def update_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    db: Session = Depends(get_db),
) -> ResponseBase[ConversationRead]:
    """更新会话元数据（当前仅支持标题）。"""
    conversation = ChatService.update_conversation(
        db=db,
        conversation_id=conversation_id,
        title=payload.title,
    )
    return ResponseBase(data=conversation)


@router.delete("/chat/conversations/{conversation_id}", response_model=BaseResponse, status_code=status.HTTP_200_OK)
async def delete_conversation(
    conversation_id: int, db: Session = Depends(get_db)
) -> BaseResponse:
    """删除指定会话及其消息。"""
    await ChatService.adelete_conversation(db, conversation_id)
    return BaseResponse(data=None)


@router.post("/chat/conversations/{conversation_id}/stream")
async def stream_conversation(
    conversation_id: int,
    request: StreamConversationRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """流式获取会话回答（SSE）。"""
    return StreamingResponse(
        ChatService.stream_conversation_answer(
            db,
            conversation_id,
            request.question,
            request.skill,
            debug_content_only=request.debug_content_only,
            extra_meta=request.extra_meta,
            auth_token=http_request.headers.get("token"),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/chat/conversations/{conversation_id}/stream/resume")
async def resume_conversation_stream(
    conversation_id: int,
    debug_content_only: bool = False,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """恢复流式会话回答（SSE），全量回放 buffer 历史后衔接实时事件。"""
    return StreamingResponse(
        ChatService.resume_conversation_stream(db, conversation_id, debug_content_only=debug_content_only),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/chat/conversations/{conversation_id}/stream/cancel", response_model=BaseResponse)
def cancel_conversation_stream(
    conversation_id: int,
) -> BaseResponse:
    """手动终止正在执行的会话流。"""
    success = ChatService.cancel_conversation_stream(conversation_id)
    if not success:
        return BaseResponse(code=400, msg="没有正在执行的流或取消失败", data=None)
    return BaseResponse(data=None)


@router.post("/chat/conversations/{conversation_id}/approve", response_model=BaseResponse)
async def approve_hitl(
    conversation_id: int,
    payload: ApproveRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> BaseResponse:
    """用户 HITL 决策后恢复 agent 执行。"""
    result = await ChatService.approve_trigger(
        db,
        conversation_id,
        message_id=payload.message_id,
        decisions=payload.decisions,
        auth_token=http_request.headers.get("token"),
        destructive_hitl=payload.destructive_hitl,
    )
    if not result.get("accepted"):
        return BaseResponse(code=400, msg=result.get("message", "审批失败"), data=None)
    return BaseResponse(data=result)


@router.post("/chat/conversations/{conversation_id}/status/reset", response_model=BaseResponse)
def reset_conversation_status(
    conversation_id: int,
    db: Session = Depends(get_db),
) -> BaseResponse:
    """重置会话状态为 idle。"""
    ChatService.reset_conversation_status(db, conversation_id)
    return BaseResponse(data=None)


@router.get("/chat/conversations/{conversation_id}/resources", response_model=ResponseBase[ResourceList])
def list_conversation_resources(
    conversation_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[ResourceList]:
    """列出会话下的资源文件（artifacts + skills-draft）。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    data = ResourceService.list_resources(settings.artifacts_path, conversation.id)
    return ResponseBase(data=data)


@router.get("/chat/conversations/{conversation_id}/resources/content", response_model=ResponseBase[ResourceContent])
def read_conversation_resource_content(
    conversation_id: int,
    path: str = Query(..., description="虚拟文件路径，如 /artifacts/report.md"),
    db: Session = Depends(get_db),
) -> ResponseBase[ResourceContent]:
    """读取会话资源文件的内容。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    content = ResourceService.read_content(settings.artifacts_path, conversation.id, path)
    if content is None:
        return ResponseBase(data=None, msg="文件不存在或路径不合法")
    return ResponseBase(data=content)


@router.post("/chat/conversations/{conversation_id}/resources/upload")
async def upload_conversation_resource(
    conversation_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ResponseBase[ResourceUploadResult]:
    """上传文件到会话的 uploads 目录。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    file_bytes = await file.read()
    filename = file.filename or "unnamed_file"
    settings = get_settings()
    result = ResourceService.upload_file(
        settings.artifacts_path,
        conversation.id,
        filename,
        file_bytes,
    )
    if isinstance(result, str):
        return ResponseBase(data=None, msg=result)
    return ResponseBase(data=result)


@router.delete("/chat/conversations/{conversation_id}/resources/uploads")
def delete_conversation_upload(
    conversation_id: int,
    path: str = Query(..., description="虚拟路径，如 /uploads/file.txt"),
    db: Session = Depends(get_db),
) -> BaseResponse:
    """删除会话 uploads 目录中的文件。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    ok = ResourceService.delete_upload_file(
        settings.artifacts_path, conversation.id, path
    )
    if not ok:
        return BaseResponse(msg="文件不存在或删除失败")
    return BaseResponse()


@router.get("/chat/conversations/{conversation_id}/resources/download")
def download_conversation_resource(
    conversation_id: int,
    path: str = Query(..., description="虚拟路径，如 /artifacts/report.md"),
    db: Session = Depends(get_db),
):
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    result = ResourceService.resolve_download_path(
        settings.artifacts_path, conversation.id, path
    )
    if result is None:
        return BaseResponse(msg="文件不存在或路径不合法")
    resolved, is_dir = result
    if is_dir:
        buf = ResourceService.create_zip(resolved)
        filename = f"{resolved.name}.zip"
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    return FileResponse(
        resolved,
        filename=resolved.name,
        media_type="application/octet-stream",
    )


@router.get("/chat/conversations/{conversation_id}/resources/static/{path:path}")
def serve_conversation_resource_static(
    conversation_id: int,
    path: str,
    db: Session = Depends(get_db),
):
    """以 inline + 正确 Content-Type 提供会话产物文件，path-based 支持相对资源。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    virtual_path = "/" + path.lstrip("/")
    result = ResourceService.resolve_download_path(
        settings.artifacts_path, conversation.id, virtual_path
    )
    if result is None:
        raise HTTPException(status_code=404, detail="not found")
    resolved, is_dir = result
    if is_dir:
        raise HTTPException(status_code=404, detail="not a file")
    media_type, _ = mimetypes.guess_type(resolved.name)
    return FileResponse(resolved, media_type=media_type or "application/octet-stream")


@router.delete("/chat/conversations/{conversation_id}/resources")
def delete_conversation_resource(
    conversation_id: int,
    path: str = Query(..., description="虚拟路径，如 /artifacts/report.md"),
    db: Session = Depends(get_db),
) -> BaseResponse:
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    ok = ResourceService.delete_resource(
        settings.artifacts_path, conversation.id, path
    )
    if not ok:
        return BaseResponse(msg="资源不存在或删除失败")
    return BaseResponse()
