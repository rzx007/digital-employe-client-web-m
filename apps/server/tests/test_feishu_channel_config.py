def test_channel_settings_defaults(monkeypatch):
    """隔离配置源：不读本地 config_kvs / env，验代码默认值。

    get_settings() 会从 config_kvs 表 + 环境变量注入，开发机若真配了
    FEISHU_WHITELIST_OPEN_IDS 等会污染本测试，故 monkeypatch 掉 kv 源并清相关 env。
    """
    import src.core.config as config

    monkeypatch.setattr(config, "_read_config_kv_data", lambda: {})
    monkeypatch.delenv("FEISHU_WHITELIST_OPEN_IDS", raising=False)
    monkeypatch.delenv("FEISHU_CHANNEL_ENABLED", raising=False)

    config.get_settings.cache_clear()
    try:
        s = config.get_settings()
        assert s.feishu_channel_enabled is False
        assert s.feishu_whitelist_open_ids is None
    finally:
        config.get_settings.cache_clear()  # 复原缓存，避免污染后续测试
