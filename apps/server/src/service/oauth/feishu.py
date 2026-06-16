import logging
from authlib.integrations.starlette_client import OAuth

logger = logging.getLogger(__name__)

oauth = OAuth()

# 记录上一次注册的 (app_id, app_secret, redirect_uri)；当 KV 在系统设置页改了
# (FEISHU_APP_ID/SECRET/REDIRECT_URI)，下次 _ensure_feishu_registered 检测到差异即重注册，
# 避免老的 "_feishu_registered=True 锁死单例" 导致改 KV 必须重启进程。
_last_registered: tuple[str, str, str] | None = None


def register_feishu(app_id: str, app_secret: str, redirect_uri: str) -> None:
    global _last_registered
    current = (app_id, app_secret, redirect_uri)
    if _last_registered == current:
        return
    # authlib 的 OAuth.create_client 会把客户端实例缓存到 oauth._clients[name]，
    # 第二次 register 同名应用时如果不先清缓存，拿到的还是旧实例（旧 client_id），
    # 导致系统设置页改 KV 后必须重启进程才生效。这里显式 pop 缓存与注册表后再注册。
    oauth._clients.pop("feishu", None)
    oauth._registry.pop("feishu", None)
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
    _last_registered = current
    logger.info("Feishu OAuth provider registered (app_id=%s)", app_id)


def get_feishu_client():
    return oauth.create_client("feishu")
