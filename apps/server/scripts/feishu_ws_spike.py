"""飞书长连接连通性 spike。用法：
  set FEISHU_APP_ID=cli_xxx & set FEISHU_APP_SECRET=xxx
  cd apps/server && uv run --no-sync python scripts/feishu_ws_spike.py
然后用白名单飞书号私聊机器人发一条文字。预期：打印事件字段 + 机器人回 "spike ok"。
"""
import json
import os

import lark_oapi as lark
from lark_oapi import EventDispatcherHandler
from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody
from lark_oapi.ws import Client as LarkWsClient

APP_ID = os.environ["FEISHU_APP_ID"]
APP_SECRET = os.environ["FEISHU_APP_SECRET"]

_api = lark.Client.builder().app_id(APP_ID).app_secret(APP_SECRET).build()


def _reply(chat_id: str, text: str):
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
    resp = _api.im.v1.message.create(req)
    print("reply success:", resp.success(), "code:", resp.code, "msg:", resp.msg)


def on_message(data) -> None:
    try:
        header = data.header
        msg = data.event.message
        sender = data.event.sender
        open_id = sender.sender_id.open_id
        chat_id = msg.chat_id
        print("=== 收到事件 ===")
        print("event_id:", header.event_id)
        print("open_id:", open_id)
        print("chat_id:", chat_id)
        print("message_id:", msg.message_id)
        print("message_type:", msg.message_type)
        print("content:", msg.content)
        _reply(chat_id, "spike ok")
    except Exception as e:
        print("on_message err:", repr(e))


def main():
    handler = (
        EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(on_message)
        .build()
    )
    client = LarkWsClient(APP_ID, APP_SECRET, event_handler=handler)
    print("connecting feishu ws ... 用飞书私聊机器人发条文字试试（Ctrl+C 退出）")
    client.start()  # 阻塞


if __name__ == "__main__":
    main()
