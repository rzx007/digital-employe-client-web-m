"""#3/#7 交付物一键返修 / 失败重试：rework 端点(包 redispatch_task_in_session)。"""
from __future__ import annotations


def test_rework_endpoint_ok(monkeypatch, db_session):
    from src.api import orchestration_api
    from src.schemas.orchestration import OrchestrationTaskRework

    monkeypatch.setattr(
        orchestration_api, "redispatch_task_in_session",
        lambda ws, tid, note: "已判定「写报告」不达标，打回重做（第 1 次返工）。",
    )
    resp = orchestration_api.rework_plan_task(
        1, 7, OrchestrationTaskRework(note="再补一段结论"), db=db_session
    )
    assert resp.data["ok"] is True
    assert "返工" in resp.data["message"]


def test_rework_endpoint_error_maps_not_ok(monkeypatch, db_session):
    from src.api import orchestration_api
    from src.schemas.orchestration import OrchestrationTaskRework

    monkeypatch.setattr(
        orchestration_api, "redispatch_task_in_session",
        lambda ws, tid, note: "错误：未找到子任务 #7。",
    )
    resp = orchestration_api.rework_plan_task(
        1, 7, OrchestrationTaskRework(note="x"), db=db_session
    )
    assert resp.data["ok"] is False


def test_rework_endpoint_limit_maps_not_ok(monkeypatch, db_session):
    from src.api import orchestration_api
    from src.schemas.orchestration import OrchestrationTaskRework

    monkeypatch.setattr(
        orchestration_api, "redispatch_task_in_session",
        lambda ws, tid, note: "任务「写报告」已返工 2 次仍不达标，已达上限。请领导定夺。",
    )
    resp = orchestration_api.rework_plan_task(
        1, 7, OrchestrationTaskRework(note="x"), db=db_session
    )
    assert resp.data["ok"] is False


def test_rework_endpoint_default_note_when_empty(monkeypatch, db_session):
    """空 note → 用默认返修说明(不传空串给 redispatch)。"""
    from src.api import orchestration_api
    from src.schemas.orchestration import OrchestrationTaskRework

    seen = {}

    def _fake(ws, tid, note):
        seen["note"] = note
        return "已判定「X」不达标，打回重做（第 1 次返工）。"

    monkeypatch.setattr(orchestration_api, "redispatch_task_in_session", _fake)
    orchestration_api.rework_plan_task(
        1, 7, OrchestrationTaskRework(note=None), db=db_session
    )
    assert seen["note"].strip() != ""
