from unittest.mock import MagicMock, patch


def test_send_text_calls_client():
    with patch("src.service.channel.feishu_im.lark") as fake_lark:
        fake_client = MagicMock()
        fake_lark.Client.builder.return_value.app_id.return_value.app_secret.return_value.build.return_value = fake_client
        from src.service.channel.feishu_im import FeishuIMService
        svc = FeishuIMService("app", "secret")
        svc.send_text("oc_123", "你好")
        # message.create 被调用一次
        assert fake_client.im.v1.message.create.called
