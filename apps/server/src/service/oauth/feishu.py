import logging
from authlib.integrations.starlette_client import OAuth

logger = logging.getLogger(__name__)

oauth = OAuth()

_feishu_registered = False


def register_feishu(app_id: str, app_secret: str, redirect_uri: str) -> None:
    global _feishu_registered
    if _feishu_registered:
        return
    oauth.register(
        name="feishu",
        client_id=app_id,
        client_secret=app_secret,
        authorize_url="https://accounts.feishu.cn/open-apis/authen/v1/authorize",
        access_token_url="https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        client_kwargs={
            "scope": "contact:user.base:readonly contact:user.employee_id:readonly",
            "token_endpoint_auth_method": "client_secret_post",
        },
    )
    _feishu_registered = True
    logger.info("Feishu OAuth provider registered (app_id=%s)", app_id)


def get_feishu_client():
    return oauth.create_client("feishu")
