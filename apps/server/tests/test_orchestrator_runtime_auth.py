from __future__ import annotations

from types import SimpleNamespace

from src.service.agent.orchestrator.runtime import (
    register_stream_session,
    resolve_auth_token,
    resolve_workspace_id,
    unregister_stream_session,
)


def test_resolve_auth_token_from_stream_session():
    register_stream_session(42, workspace_id=1, auth_token="user-token")
    try:
        runtime = SimpleNamespace(
            config={"configurable": {"thread_id": 42}},
        )
        assert resolve_auth_token(runtime) == "user-token"
        assert resolve_workspace_id(runtime) == 1
    finally:
        unregister_stream_session(42)
