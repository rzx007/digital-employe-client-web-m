"""工作区外目录写授权：端到端集成测试。

串起完整授权链路：guard_external_write → _apply_external_dir_grant / set_external_dir_mode
→ record_grant / is_granted，所有函数均真实调用，不 mock。
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.path_authorization import (
    guard_external_write,
    is_granted,
    set_external_dir_mode,
)
from src.service.chat_service import _apply_external_dir_grant


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def conversation(db_session: Session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=1,
        title="e2e 授权链路测试会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def _ctx(db_session, workspace, conversation, tmp_path):
    """构造 guard_external_write 所需关键字参数。"""
    (tmp_path / "artifacts").mkdir(exist_ok=True)
    return dict(
        db=db_session,
        workspace_id=workspace.id,
        conversation_id=conversation.id,
        roots=[tmp_path / "artifacts"],
    )


# ---------------------------------------------------------------------------
# 场景 1：挡回 → approve(permanent) → 重试放行
# ---------------------------------------------------------------------------


def test_e2e_permanent_grant_flow(db_session, workspace, conversation, tmp_path):
    """挡回 → authorize(permanent) → 再次 guard 放行。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)
    external_dir = tmp_path / "external"
    external_dir.mkdir()
    target = str(external_dir / "data.csv")

    # 1. 首次 guard → 被挡，提示申请授权
    msg = guard_external_write(target, **ctx)
    assert msg is not None
    assert "request_external_dir_access" in msg

    # 2. 模拟 approve：permanent 授权父目录
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": str(external_dir), "scope": "permanent"},
    )

    # 3. 再次 guard → 放行
    assert guard_external_write(target, **ctx) is None

    # 4. 子路径也放行
    child_target = str(external_dir / "sub" / "report.txt")
    assert guard_external_write(child_target, **ctx) is None


# ---------------------------------------------------------------------------
# 场景 2：once 一次性 —— 第一次放行，第二次挡回
# ---------------------------------------------------------------------------


def test_e2e_once_scope_consumed_after_first_use(db_session, workspace, conversation, tmp_path):
    """once scope：第一次 guard 放行，第二次被挡回。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)
    external_dir = tmp_path / "once_dir"
    external_dir.mkdir()
    target1 = str(external_dir / "file1.txt")
    target2 = str(external_dir / "file2.txt")

    # approve(once)
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": str(external_dir), "scope": "once"},
    )

    # 第一次放行
    assert guard_external_write(target1, **ctx) is None

    # 第二次被挡（令牌已消费）
    msg2 = guard_external_write(target2, **ctx)
    assert msg2 is not None


# ---------------------------------------------------------------------------
# 场景 3：session scope —— 同子路径均放行
# ---------------------------------------------------------------------------


def test_e2e_session_scope_allows_subtree(db_session, workspace, conversation, tmp_path):
    """session scope：目录及所有子路径 guard 均放行。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)
    external_dir = tmp_path / "session_dir"
    external_dir.mkdir()

    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": str(external_dir), "scope": "session"},
    )

    assert guard_external_write(str(external_dir / "a.txt"), **ctx) is None
    assert guard_external_write(str(external_dir / "sub" / "b.txt"), **ctx) is None
    assert guard_external_write(str(external_dir / "deep" / "nest" / "c.txt"), **ctx) is None


# ---------------------------------------------------------------------------
# 场景 4：mode=deny 直拒，不含 request_external_dir_access
# ---------------------------------------------------------------------------


def test_e2e_deny_mode_rejects_with_strict_message(db_session, workspace, conversation, tmp_path):
    """deny 模式：返回含「严格」的串，且不引导申请授权。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)
    external_path = str(tmp_path / "denied" / "file.txt")

    set_external_dir_mode(db_session, conversation.id, "deny")

    msg = guard_external_write(external_path, **ctx)
    assert msg is not None
    assert "严格" in msg
    # deny 是直拒，不应引导用户调用 request_external_dir_access
    assert "request_external_dir_access" not in msg


# ---------------------------------------------------------------------------
# 场景 5：mode=auto 静默放行任意外部路径
# ---------------------------------------------------------------------------


def test_e2e_auto_mode_allows_any_external_path(db_session, workspace, conversation, tmp_path):
    """auto 模式：任意工作区外路径 guard 返回 None。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)

    set_external_dir_mode(db_session, conversation.id, "auto")

    assert guard_external_write(str(tmp_path / "anywhere" / "x.txt"), **ctx) is None
    assert guard_external_write("/some/completely/different/path.txt", **ctx) is None


# ---------------------------------------------------------------------------
# 场景 6：workspace.auto_grant_external_dirs=True 静默放行
# ---------------------------------------------------------------------------


def test_e2e_workspace_auto_grant_flag_allows_all(db_session, workspace, conversation, tmp_path):
    """workspace.auto_grant_external_dirs=True 时，任意外部路径放行。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)

    # 先确认默认被挡
    external_path = str(tmp_path / "ws_auto" / "data.txt")
    msg_before = guard_external_write(external_path, **ctx)
    assert msg_before is not None

    # 设置 workspace 列
    workspace.auto_grant_external_dirs = True
    db_session.add(workspace)
    db_session.commit()
    db_session.refresh(workspace)

    # 再次 guard → 放行
    assert guard_external_write(external_path, **ctx) is None
    # 另一个路径也放行
    assert guard_external_write("/another/external/file.py", **ctx) is None


# ---------------------------------------------------------------------------
# 场景 7：工作区内写不受任何 mode 影响（始终 None）
# ---------------------------------------------------------------------------


def test_e2e_internal_write_always_allowed(db_session, workspace, conversation, tmp_path):
    """工作区内路径无论 mode 如何，guard 始终返回 None。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)
    internal_path = str(tmp_path / "artifacts" / "output.txt")

    # 默认 ask 模式
    assert guard_external_write(internal_path, **ctx) is None

    # deny 模式下工作区内仍放行
    set_external_dir_mode(db_session, conversation.id, "deny")
    assert guard_external_write(internal_path, **ctx) is None

    # auto 模式下工作区内也放行
    set_external_dir_mode(db_session, conversation.id, "auto")
    assert guard_external_write(internal_path, **ctx) is None


# ---------------------------------------------------------------------------
# 场景 8：隔离断言 —— 非法/缺字段 approve 均 no-op，不误记授权
# ---------------------------------------------------------------------------


def test_e2e_invalid_approve_is_noop(db_session, workspace, conversation, tmp_path):
    """None / 缺字段 / 非法 scope 的 approve 均不抛异常，且不误记任何授权。"""
    ctx = _ctx(db_session, workspace, conversation, tmp_path)
    probe_path = str(tmp_path / "probe" / "file.txt")
    probe_dir = str(tmp_path / "probe")
    x_dir = "/x"

    # None → no-op
    _apply_external_dir_grant(db_session, workspace.id, conversation.id, None)

    # 缺 path
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"scope": "permanent"},
    )

    # 缺 scope
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": x_dir},
    )

    # 非法 scope
    _apply_external_dir_grant(
        db_session, workspace.id, conversation.id,
        {"path": x_dir, "scope": "bogus"},
    )

    # 以上均不应记录任何授权
    assert is_granted(db_session, workspace.id, conversation.id, probe_path) is False
    assert is_granted(db_session, workspace.id, conversation.id, x_dir + "/sub") is False

    # guard 仍挡回（证明无误记）
    msg = guard_external_write(probe_path, **ctx)
    assert msg is not None
    assert "request_external_dir_access" in msg
