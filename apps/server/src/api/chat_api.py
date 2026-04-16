from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.conversation import ConversationCreate, ConversationMessageRead, ConversationRead, StreamConversationRequest
from src.service.chat_service import ChatService

router = APIRouter(tags=["对话"])


@router.post("/chat/conversations", response_model=ResponseBase[ConversationRead])
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
) -> ResponseBase[ConversationRead]:
    """创建会话。"""
    conversation = ChatService.create_conversation(
        db=db,
        workspace_id=payload.workspace_id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        title=payload.title,
    )
    return ResponseBase(data=conversation)


@router.get("/chat/conversations", response_model=ListResponse[ConversationRead])
def list_conversations(
    workspace_id: int = Query(...),
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


@router.get("/chat/conversations/{conversation_id}/messages", response_model=ListResponse[ConversationMessageRead])
def list_conversation_messages(conversation_id: int, db: Session = Depends(get_db)) -> ListResponse[ConversationMessageRead]:
    """查询指定会话下的消息列表。"""
    messages = ChatService.list_messages(db, conversation_id)
    return ListResponse[ConversationMessageRead](data=messages)


@router.delete("/chat/conversations/{conversation_id}", response_model=BaseResponse, status_code=status.HTTP_200_OK)
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """删除指定会话及其消息。"""
    ChatService.delete_conversation(db, conversation_id)
    return BaseResponse(data=None)


@router.post("/chat/conversations/{conversation_id}/stream")
async def stream_conversation(
    conversation_id: int,
    request: StreamConversationRequest,
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
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
