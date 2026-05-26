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
