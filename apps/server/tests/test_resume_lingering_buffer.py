"""resume 对「已完成但仍 linger 的自发 turn」应重放 buffer 正文，而非只发 stream_ended。

背景：后台命令唤醒 / 汇报等服务端自发的总管 turn 常很短，前端绕完
「收事件→invalidate→重拉→resume」去接时 turn 已结束 → task 终态但仍 linger
(TASK_TTL_SECONDS=20s)、buffer 里有完整正文。原先 resume 一看到终态就只发
stream_ended、丢掉 buffer 正文 → 前端留空壳，必须切会话重灌 DB 才显示。
修复后：终态但 buffer 仍有正文 → 先重放正文再收尾。
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from src.service.chat_service import ChatService
from src.service.stream_registry import ActiveStreamTask, StreamRegistry


async def _collect(gen) -> str:
    out: list[str] = []
    async for chunk in gen:
        out.append(chunk)
    return "".join(out)


def _make_completed_lingering_task(conv: int) -> ActiveStreamTask:
    task = ActiveStreamTask(conv)
    # 自发短 turn：已产出正文 + 终态事件，仍 linger 在 registry（未到 TTL）
    task.buffer.add({"type": "text-delta", "delta": "回调通知正文-甲"})
    task.buffer.add({"type": "text-delta", "delta": "回调通知正文-乙"})
    task.buffer.add({"status": "completed"})
    task.status = "completed"  # is_active = (status=="streaming") → False，终态
    return task


def test_resume_replays_lingering_buffer_for_completed_turn(monkeypatch):
    conv = 9001
    reg = StreamRegistry()
    reg._tasks[conv] = _make_completed_lingering_task(conv)

    # resume 函数内 `from ... import registry` 在调用时解析 → 可被替换
    monkeypatch.setattr("src.service.stream_registry.registry", reg)
    # 终态分支会调 reconcile（查 DB）——本测不关心 DB 收敛，置为 no-op
    monkeypatch.setattr(
        "src.service.chat_service.reconcile_stale_stream_state_on_resume",
        lambda *a, **k: False,
    )

    db = MagicMock()
    db.scalar.return_value = None  # 无 stale 消息

    blob = asyncio.run(_collect(ChatService.resume_conversation_stream(db, conv)))

    # 修复前：只发 stream_ended，正文丢失 → 断言失败
    assert "回调通知正文-甲" in blob, f"buffer 正文未被重放: {blob!r}"
    assert "回调通知正文-乙" in blob, f"buffer 正文未被重放: {blob!r}"
    assert "[DONE]" in blob


def test_resume_live_active_task_cold_replay_no_unbound(monkeypatch):
    """live 路径(活跃 task)冷启回放会走到 get_settings()——曾因在终态分支里写了函数内
    `from ... import get_settings`，把它变成整函数局部 → live 路径用它时 UnboundLocalError，
    导致正常聊天("你好")整个炸。守此回归：活跃 task 冷启回放必须正常出正文、不抛。"""
    conv = 9003
    reg = StreamRegistry()
    task = ActiveStreamTask(conv)
    task.status = "streaming"  # 活跃 → get_stream_status 返 None → 走 live 路径
    task.buffer.add({"type": "text-delta", "delta": "活流正文"})
    task.buffer.add({"status": "completed"})  # buffer 自带终态 → 回放后即 return，不挂 live 订阅
    reg._tasks[conv] = task

    monkeypatch.setattr("src.service.stream_registry.registry", reg)

    db = MagicMock()
    db.scalar.return_value = None

    blob = asyncio.run(_collect(ChatService.resume_conversation_stream(db, conv)))
    assert "活流正文" in blob
    assert "[DONE]" in blob


def test_resume_no_buffer_keeps_stream_ended(monkeypatch):
    """无可重放 buffer（buffer 空）的终态 → 维持原行为：只发 stream_ended，不报错。"""
    conv = 9002
    reg = StreamRegistry()
    task = ActiveStreamTask(conv)
    task.status = "completed"  # 终态、buffer 空
    reg._tasks[conv] = task

    monkeypatch.setattr("src.service.stream_registry.registry", reg)
    monkeypatch.setattr(
        "src.service.chat_service.reconcile_stale_stream_state_on_resume",
        lambda *a, **k: False,
    )

    db = MagicMock()
    db.scalar.return_value = None

    blob = asyncio.run(_collect(ChatService.resume_conversation_stream(db, conv)))
    assert "stream_ended" in blob
    assert "[DONE]" in blob
