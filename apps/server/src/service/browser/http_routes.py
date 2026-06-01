"""FastAPI proxy to Electron browser bridge (optional same-process discovery)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.service.browser.browser_runtime_client import (
    BrowserRuntimeClient,
    default_session_id,
)

router = APIRouter(prefix="/internal/browser", tags=["browser"])

_client: BrowserRuntimeClient | None = None


def get_client() -> BrowserRuntimeClient:
    global _client
    if _client is None:
        _client = BrowserRuntimeClient()
    return _client


class NavigateBody(BaseModel):
    url: str


class SnapshotBody(BaseModel):
    max_nodes: int = 200


class RefBody(BaseModel):
    ref_or_selector: str
    confirmation_required: bool = False
    confirmation_message: str | None = None


class FillBody(BaseModel):
    ref_or_selector: str
    text: str = Field(default="")


def _raise_if_failed(result, *, not_found_ok: bool = False) -> dict:
    if result.ok:
        return result.data
    if not_found_ok and result.error == "ELEMENT_NOT_FOUND":
        raise HTTPException(status_code=404, detail=result.error)
    raise HTTPException(status_code=502, detail=result.error or "browser error")


@router.post("/{session_id}/navigate")
async def navigate(session_id: str, body: NavigateBody):
    result = await get_client().navigate(session_id, body.url)
    data = _raise_if_failed(result)
    return {"ok": True, "data": data}


@router.post("/{session_id}/snapshot")
async def snapshot(session_id: str, body: SnapshotBody | None = None):
    max_nodes = body.max_nodes if body else 200
    result = await get_client().snapshot(session_id, max_nodes)
    data = _raise_if_failed(result)
    return {"ok": True, "data": data}


@router.post("/{session_id}/click")
async def click(session_id: str, body: RefBody):
    result = await get_client().click(
        session_id,
        body.ref_or_selector,
        confirmation_required=body.confirmation_required,
        confirmation_message=body.confirmation_message,
    )
    if not result.ok and result.error == "USER_CANCELLED":
        raise HTTPException(status_code=409, detail="USER_CANCELLED")
    _raise_if_failed(result, not_found_ok=True)
    return {"ok": True}


@router.post("/{session_id}/fill")
async def fill(session_id: str, body: FillBody):
    result = await get_client().fill(
        session_id, body.ref_or_selector, body.text
    )
    _raise_if_failed(result, not_found_ok=True)
    return {"ok": True}


@router.post("/{session_id}/extract-text")
async def extract_text(session_id: str):
    result = await get_client().extract_text(session_id)
    data = _raise_if_failed(result)
    return {"ok": True, "data": data}


@router.post("/{session_id}/screenshot")
async def screenshot(session_id: str):
    result = await get_client().screenshot(session_id)
    data = _raise_if_failed(result)
    return {"ok": True, "data": data}


@router.post("/{session_id}/get-url")
async def get_url(session_id: str):
    result = await get_client().get_url(session_id)
    data = _raise_if_failed(result)
    return {"ok": True, "data": data}


@router.post("/{session_id}/get-title")
async def get_title(session_id: str):
    result = await get_client().get_title(session_id)
    data = _raise_if_failed(result)
    return {"ok": True, "data": data}


__all__ = ["router", "default_session_id"]
