"""轮询器配置：全部来自环境变量。"""

from __future__ import annotations

import os


def get_poll_config() -> dict:
    return {
        "app_id": os.getenv("FEISHU_APP_ID", "").strip(),
        "app_secret": os.getenv("FEISHU_APP_SECRET", "").strip(),
        "approval_code": os.getenv("FEISHU_APPROVAL_CODE", "").strip(),
        "device_field": os.getenv("FEISHU_DEVICE_CODE_FIELD", "").strip(),
        "expires_field": os.getenv("FEISHU_EXPIRES_FIELD", "").strip(),
        "comment_prefix": os.getenv("FEISHU_LICENSE_COMMENT_PREFIX", "【激活授权码】"),
        "poll_interval": int(os.getenv("POLL_INTERVAL", "60")),
        "default_expires": os.getenv("ISSUER_DEFAULT_EXPIRES", "+90d").strip() or "+90d",
    }


def validate_config(cfg: dict) -> list[str]:
    """返回缺失的必填项列表（空=齐全）。"""
    required = ["app_id", "app_secret", "approval_code", "device_field"]
    return [k for k in required if not cfg.get(k)]
