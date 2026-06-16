"""总管整盘执行快照：build_delegation_execution_context 单测。"""

from __future__ import annotations

from src.models.conversation import Conversation
from src.models.employee import Employee
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now
from src.service.agent.orchestrator.prompts import build_delegation_execution_context
from tests.conftest import add_employee


def _make_conversation(db_session, workspace_id: int) -> Conversation:
    """创建一个 target_type=curator 的总管会话。"""
    conv = Conversation(
        workspace_id=workspace_id,
        target_type="curator",
        target_id=0,
        title="测试总管会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    return conv


def _make_log(
    db_session,
    workspace_id: int,
    employee_id: int,
    orchestrator_conversation_id: int,
    *,
    task_name: str,
    run_status: str,
    output_json: str = "{}",
    error_message: str | None = None,
) -> TaskExecutionLog:
    log = TaskExecutionLog(
        workspace_id=workspace_id,
        employee_id=employee_id,
        orchestrator_conversation_id=orchestrator_conversation_id,
        task_name_snapshot=task_name,
        run_status=run_status,
        output_json=output_json,
        error_message=error_message,
        input_json="{}",
        started_at=cst_now(),
    )
    db_session.add(log)
    db_session.commit()
    db_session.refresh(log)
    return log


def test_snapshot_contains_both_tasks_and_reflects_status(
    db_session, workspace: Workspace
):
    """快照应包含 success + running 两条任务，各自体现状态与结果。"""
    emp = add_employee(db_session, workspace.id, name="微博热搜助手")
    conv = _make_conversation(db_session, workspace.id)

    _make_log(
        db_session,
        workspace.id,
        emp.id,
        conv.id,
        task_name="查询微博热搜",
        run_status="success",
        output_json='{"content": "TOP1 测试话题\\nTOP2 另一话题"}',
    )
    _make_log(
        db_session,
        workspace.id,
        emp.id,
        conv.id,
        task_name="撰写日报",
        run_status="running",
    )

    result = build_delegation_execution_context(db_session, workspace.id, conv.id)

    # 两个任务名均出现
    assert "查询微博热搜" in result
    assert "撰写日报" in result

    # success 任务的结果摘要出现
    assert "TOP1 测试话题" in result

    # running 任务体现执行中状态（中文或英文均可）
    assert "running" in result.lower() or "执行中" in result or "正在" in result


def test_snapshot_output_truncated_by_output_max_chars(
    db_session, workspace: Workspace
):
    """output_max_chars 应截断员工交付摘要。"""
    emp = add_employee(db_session, workspace.id, name="文档助手")
    conv = _make_conversation(db_session, workspace.id)

    long_content = "A" * 200
    _make_log(
        db_session,
        workspace.id,
        emp.id,
        conv.id,
        task_name="写长文档",
        run_status="success",
        output_json=f'{{"content": "{long_content}"}}',
    )

    # 用很小的 output_max_chars 触发截断
    result = build_delegation_execution_context(
        db_session, workspace.id, conv.id, output_max_chars=10
    )

    # 截断符号或提示出现（extract_execution_output_text 在截断时追加 "…（已截断"）
    assert "已截断" in result or "…" in result
    # 内容不应全量出现（200 个 A 不会全出现）
    assert "A" * 200 not in result


def test_snapshot_empty_when_no_logs(db_session, workspace: Workspace):
    """无执行记录时返回提示性空串（不崩溃）。"""
    conv = _make_conversation(db_session, workspace.id)

    result = build_delegation_execution_context(db_session, workspace.id, conv.id)

    # 应返回字符串（可能是空串或提示文字），不应 raise
    assert isinstance(result, str)
    assert len(result) > 0  # 函数返回提示文字而非纯空串
