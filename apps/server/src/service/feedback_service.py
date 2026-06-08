"""BUG 反馈：采集环境/日志、组装载荷、转发到远端后台（与 login_api 同范式）。"""
from __future__ import annotations

import logging
import os
import platform

import httpx

from src.core.config import get_default_logs_dir, get_settings, is_offline_mode

logger = logging.getLogger(__name__)

_LOG_DIR = get_default_logs_dir()
_LOG_FILES = ("app.log", "error.log")


def _feedback_url() -> str | None:
    return (get_settings().feedback_url or "").strip() or None


def collect_env() -> dict:
    """自动采集环境信息（app 版本经 Electron 注入 APP_VERSION；缺失退化 unknown）。"""
    return {
        "app_version": os.getenv("APP_VERSION") or "unknown",
        "os": platform.system(),
        "arch": platform.machine(),
        "offline": is_offline_mode(),
    }


def collect_logs(cap_lines: int = 500, cap_bytes: int = 200_000) -> str | None:
    """读取 app.log + error.log 末尾，按行/字节双封顶。文件缺失返回 None。"""
    chunks: list[str] = []
    for name in _LOG_FILES:
        path = _LOG_DIR / name
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        tail = "\n".join(lines[-cap_lines:])
        chunks.append(f"===== {name} (尾部 {min(len(lines), cap_lines)} 行) =====\n{tail}")
    if not chunks:
        return None
    text = "\n\n".join(chunks)
    if len(text) > cap_bytes:
        text = text[-cap_bytes:]
    return text


def submit_feedback(payload: dict, token: str | None) -> dict:
    """转发上报到远端后台。返回 {ok, message, remote?}，不抛异常给调用方。"""
    if is_offline_mode():
        return {"ok": False, "message": "离线模式下无法上报反馈，请联网后重试。"}
    url = _feedback_url()
    if not url:
        return {"ok": False, "message": "反馈服务未配置（缺少 REMOTE_API_BASE_URL/FEEDBACK_PATH）。"}
    headers = {"token": token} if token else None
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=30.0)
        resp.raise_for_status()
        return {"ok": True, "message": "已提交反馈。", "remote": resp.json()}
    except httpx.HTTPError as exc:
        logger.error("feedback 转发失败: %s", exc, exc_info=True)
        return {"ok": False, "message": "上报失败：网络不可达或服务异常，请稍后重试。"}
    except ValueError:
        return {"ok": True, "message": "已提交反馈。", "remote": None}
