"""渠道凭证隔离：get_channel_credentials 按 {CHANNEL}_CHANNEL_APP_ID/SECRET 读取，
与登录用的 FEISHU_APP_ID/SECRET 完全隔离。"""

from src.service.channel.credentials import get_channel_credentials


def test_get_channel_credentials_feishu(monkeypatch):
    """配了 FEISHU_CHANNEL_APP_ID/SECRET 时按渠道名返回该对，不读登录 FEISHU_APP_*。"""
    import src.service.channel.credentials as cred

    fake_kv = {
        "FEISHU_CHANNEL_APP_ID": "cli_x",
        "FEISHU_CHANNEL_APP_SECRET": "sec_y",
        # 登录凭证：不应被渠道读取
        "FEISHU_APP_ID": "login_app",
        "FEISHU_APP_SECRET": "login_secret",
    }
    monkeypatch.setattr(cred, "_read_config_kv_data", lambda: fake_kv)

    assert get_channel_credentials("feishu") == ("cli_x", "sec_y")
    # 大小写不敏感
    assert get_channel_credentials("FEISHU") == ("cli_x", "sec_y")


def test_get_channel_credentials_unconfigured(monkeypatch):
    """未配渠道（如 dingtalk）返回 (None, None)。"""
    import src.service.channel.credentials as cred

    monkeypatch.setattr(cred, "_read_config_kv_data", lambda: {})
    assert get_channel_credentials("dingtalk") == (None, None)
    assert get_channel_credentials("feishu") == (None, None)


def test_get_channel_credentials_empty_string_is_none(monkeypatch):
    """空串/纯空白当作未配置 → None。"""
    import src.service.channel.credentials as cred

    fake_kv = {
        "FEISHU_CHANNEL_APP_ID": "  ",
        "FEISHU_CHANNEL_APP_SECRET": "",
    }
    monkeypatch.setattr(cred, "_read_config_kv_data", lambda: fake_kv)
    assert get_channel_credentials("feishu") == (None, None)
