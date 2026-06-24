def test_channel_settings_defaults(monkeypatch):
    from src.core.config import get_settings
    get_settings.cache_clear()
    s = get_settings()
    assert s.feishu_channel_enabled is False
    assert s.feishu_whitelist_open_ids is None
