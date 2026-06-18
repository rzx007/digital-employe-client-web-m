"""启动入口：
  python -m license_issuer_server         # 起 HTTP 签发服务（/license/issue）
  python -m license_issuer_server poll     # 起飞书审批轮询器
"""

from __future__ import annotations

import logging
import os
import sys


def _run_http() -> None:
    import uvicorn
    host = os.getenv("ISSUER_HOST", "0.0.0.0")
    port = int(os.getenv("ISSUER_PORT", "8900"))
    uvicorn.run("license_issuer_server.app:app", host=host, port=port)


def _run_poll() -> None:
    from license_issuer_server.poller_config import get_poll_config, validate_config
    from license_issuer_server.feishu_token import FeishuToken
    from license_issuer_server.feishu_approval import FeishuApproval
    from license_issuer_server.poller import run_forever
    from license_issuer_server.config import get_private_key_path
    from license_issuer.service import IssueService

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = get_poll_config()
    missing = validate_config(cfg)
    if missing:
        sys.stderr.write(f"轮询器缺少必填配置: {', '.join(missing)}\n")
        sys.exit(2)

    priv = get_private_key_path()
    if not priv.exists():
        sys.stderr.write(f"签发私钥不存在: {priv}\n")
        sys.exit(2)

    token = FeishuToken(cfg["app_id"], cfg["app_secret"])
    approval = FeishuApproval(token, cfg["approval_code"], cfg["device_field"],
                              cfg["expires_field"], cfg["comment_prefix"])
    run_forever(approval, IssueService(), priv, cfg["default_expires"],
                interval=cfg["poll_interval"])


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "poll":
        _run_poll()
    else:
        _run_http()


if __name__ == "__main__":
    main()
