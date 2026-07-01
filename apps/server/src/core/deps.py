from fastapi import HTTPException, status
from src.core.runtime_capabilities import get_capabilities

def require_capability(name: str):
    def _dep():
        if not getattr(get_capabilities(), name, False):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"离线模式不可用: {name}"
            )
    return _dep


def require_activation():
    """显式 Depends：未激活 / 过期则 403（与 ActivationMiddleware 双保险）。"""
    def _dep():
        from src.core.activation_gateway import ActivationGateway

        ActivationGateway.ensure_activated()
    return _dep
