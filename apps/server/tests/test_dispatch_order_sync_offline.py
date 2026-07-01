from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.service.dispatch_order_sync_service import DispatchOrderSyncService
from src.service.task_scheduler_service import TaskSchedulerService


def test_sync_and_trigger_skips_when_capability_disabled(monkeypatch) -> None:
    caps = MagicMock()
    caps.dispatch_order_sync = False
    monkeypatch.setattr(
        "src.core.runtime_capabilities.get_capabilities",
        lambda: caps,
    )

    result = DispatchOrderSyncService.sync_and_trigger()

    assert result == {
        "synced_count": 0,
        "inserted_count": 0,
        "updated_count": 0,
        "triggered_count": 0,
    }


def test_run_dispatch_order_sync_job_swallows_remote_errors(monkeypatch) -> None:
    caps = MagicMock()
    caps.dispatch_order_sync = True
    monkeypatch.setattr(
        "src.core.runtime_capabilities.get_capabilities",
        lambda: caps,
    )

    def _fail() -> dict[str, int]:
        raise HTTPException(status_code=502, detail="远程绩效接口请求失败")

    monkeypatch.setattr(
        "src.service.dispatch_order_sync_service.DispatchOrderSyncService.sync_and_trigger",
        _fail,
    )

    TaskSchedulerService.run_dispatch_order_sync_job()
