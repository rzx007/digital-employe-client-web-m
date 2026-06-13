from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from src.models.response import ResponseBase

router = APIRouter(tags=["用户头像"])
logger = logging.getLogger(__name__)

# 头像存储目录：与 conversations / local-skills 同级，本机用户数据根下。
AVATAR_DIR = Path.home() / ".digital-employee" / "avatars"

# 允许的图片类型 → 落盘扩展名
_ALLOWED_CONTENT_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}
_MAX_BYTES = 5 * 1024 * 1024  # 5MB


def _existing_avatar_path(user_id: str) -> Path | None:
    """返回该 user_id 已存在的头像文件（任一允许扩展名），无则 None。"""
    for ext in ("png", "jpg", "webp"):
        p = AVATAR_DIR / f"{user_id}.{ext}"
        if p.is_file():
            return p
    return None


@router.post("/avatars/{user_id}", response_model=ResponseBase[dict])
async def upload_avatar(user_id: str, file: UploadFile = File(...)) -> ResponseBase[dict]:
    ext = _ALLOWED_CONTENT_TYPES.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="仅支持 PNG / JPG / WEBP 图片",
        )

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="图片不能超过 5MB")
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")

    AVATAR_DIR.mkdir(parents=True, exist_ok=True)

    # 删除该用户其它扩展名的旧头像，避免 png→jpg 后残留旧图被 GET 命中
    for old_ext in ("png", "jpg", "webp"):
        if old_ext != ext:
            old = AVATAR_DIR / f"{user_id}.{old_ext}"
            if old.is_file():
                try:
                    old.unlink()
                except OSError as exc:
                    logger.warning("删除旧头像失败 %s: %s", old, exc)

    target = AVATAR_DIR / f"{user_id}.{ext}"
    try:
        target.write_bytes(data)
    except OSError as exc:
        logger.error("写入头像失败 %s: %s", target, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="保存头像失败") from exc

    logger.info("头像已更新 user_id=%s ext=%s bytes=%d", user_id, ext, len(data))
    return ResponseBase(data={"avatar_url": f"/avatars/{user_id}"})


@router.get("/avatars/{user_id}")
def get_avatar(user_id: str) -> FileResponse:
    path = _existing_avatar_path(user_id)
    if not path:
        raise HTTPException(status_code=404, detail="未设置头像")
    return FileResponse(path)
