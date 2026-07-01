from __future__ import annotations

from src.core.config import _read_config_kv_data


def _read_kv(key: str) -> str | None:
    """从 config_kvs 读单个 key 的规整值；空串/缺失→None。

    走 config._read_config_kv_data()（每次直读 sqlite，不经 get_settings 的
    lru_cache），保证设置页热更新后能立即读到最新值、不吃陈旧缓存。
    """
    value = _read_config_kv_data().get(key)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized if normalized else None


def get_channel_credentials(channel: str) -> tuple[str | None, str | None]:
    """按渠道名读独立凭证 {CHANNEL}_CHANNEL_APP_ID / _SECRET（与登录的
    FEISHU_APP_ID/SECRET 隔离）。

    后续接新渠道（钉钉/微信等）只需配对应 key，无需改此函数。
    返回 (app_id, app_secret)，未配为 None。
    """
    name = channel.strip().upper()
    app_id = _read_kv(f"{name}_CHANNEL_APP_ID")
    app_secret = _read_kv(f"{name}_CHANNEL_APP_SECRET")
    return app_id, app_secret
