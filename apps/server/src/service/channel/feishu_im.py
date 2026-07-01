import json

import lark_oapi as lark
from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody


class FeishuIMService:
    """飞书出站发文本。lark-oapi Client 自管 tenant_access_token（缓存+刷新）。

    // API 形态待 spike 在真实凭证下端到端校验（receive_id_type / content schema）。
    """

    def __init__(self, app_id: str, app_secret: str):
        self._client = (
            lark.Client.builder().app_id(app_id).app_secret(app_secret).build()
        )

    def send_text(self, chat_id: str, text: str) -> None:
        req = (
            CreateMessageRequest.builder()
            .receive_id_type("chat_id")
            .request_body(
                CreateMessageRequestBody.builder()
                .receive_id(chat_id)
                .msg_type("text")
                .content(json.dumps({"text": text}))
                .build()
            )
            .build()
        )
        self._client.im.v1.message.create(req)
