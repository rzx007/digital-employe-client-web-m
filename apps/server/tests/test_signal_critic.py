"""2B：信号闸门 critic。"""
import json
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from tests.conftest import add_employee


def _log(db, ws_id, emp_id, *, task_id, status, error=None):
    lg = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id,
        task_name_snapshot="活", run_status=status,
        output_json=json.dumps({"content": "ok"}, ensure_ascii=False),
        error_message=error, started_at=cst_now(), ended_at=cst_now(),
    )
    db.add(lg); db.commit(); db.refresh(lg)
    return lg


def test_detect_failure_then_success_positive(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=7, status="failed", error="ModuleNotFound xyz")
    success = _log(db_session, workspace.id, emp.id, task_id=7, status="success")
    ctx = detect_failure_then_success(db_session, success)
    assert ctx is not None
    assert "xyz" in ctx


def test_detect_no_prior_failure_returns_none(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    success = _log(db_session, workspace.id, emp.id, task_id=8, status="success")
    assert detect_failure_then_success(db_session, success) is None


def test_detect_non_success_log_returns_none(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=9, status="failed", error="x")
    failed2 = _log(db_session, workspace.id, emp.id, task_id=9, status="failed", error="y")
    assert detect_failure_then_success(db_session, failed2) is None


def test_maybe_reflect_no_signal_skips_llm(db_session, workspace, monkeypatch):
    """无信号（普通成功）→ 不调 LLM。"""
    from src.service import reflection_engine as re
    monkeypatch.setattr(re, "_build_llm", lambda: (_ for _ in ()).throw(AssertionError("不该调LLM")))
    emp = add_employee(db_session, workspace.id, name="w")
    success = _log(db_session, workspace.id, emp.id, task_id=20, status="success")
    re.maybe_reflect_on_signal(db_session, success)  # 不抛、不调 LLM


def test_maybe_reflect_on_signal_writes_memory(db_session, workspace, monkeypatch, tmp_path):
    """失败后成功 → 调 LLM 提炼 → 写 memory。"""
    from src.service import reflection_engine as re

    class _FakeLLM:
        def invoke(self, prompt):
            assert "失败" in prompt
            class _R: content = "§上次因缺依赖失败，先 pip install 再跑"
            return _R()

    monkeypatch.setattr(re, "_build_llm", lambda: _FakeLLM())
    monkeypatch.setattr(re, "_resolve_memories_path", lambda eid: tmp_path / str(eid) / "memories")
    monkeypatch.setattr(re, "_get_conversation_messages", lambda db, cid: "用户:做X\n助手:好")
    re._reflect_locks.clear()

    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=21, status="failed", error="缺依赖")
    success = _log(db_session, workspace.id, emp.id, task_id=21, status="success")
    success.conversation_id = 1; db_session.commit()

    re.maybe_reflect_on_signal(db_session, success)

    mem = (tmp_path / str(emp.id) / "memories" / "AGENTS.md")
    assert mem.exists()
    assert "pip install" in mem.read_text(encoding="utf-8")
