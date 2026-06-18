"""总管子任务完成摘要消息。"""

from __future__ import annotations

from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from src.service.orchestrator_execution_summary import build_execution_summary_content


def _make_log(**kwargs) -> TaskExecutionLog:
    defaults = {
        "id": 1,
        "task_id": 10,
        "workspace_id": 1,
        "employee_id": 19,
        "skill_id": None,
        "conversation_id": 64,
        "orchestrator_conversation_id": 50,
        "task_name_snapshot": "查询微博热搜",
        "run_status": "success",
        "run_result": "任务执行成功",
        "error_message": None,
        "input_json": "{}",
        "output_json": '{"content": "TOP1 测试话题\\nTOP2 另一话题"}',
        "started_at": cst_now(),
        "ended_at": cst_now(),
        "duration_ms": 25400,
    }
    defaults.update(kwargs)
    return TaskExecutionLog(**defaults)


def test_build_execution_summary_content_success():
    text = build_execution_summary_content(_make_log(), "微博热搜助手")
    assert "【任务完成】" in text
    assert "查询微博热搜" in text
    assert "微博热搜助手" in text
    assert "员工会话 #64" in text
    assert "25.4s" in text
    assert "TOP1 测试话题" in text
    assert "可点击下方卡片进入员工对话查看详情" in text


def test_build_execution_summary_content_failed():
    text = build_execution_summary_content(
        _make_log(
            run_status="failed",
            output_json="{}",
            error_message="网络超时",
        ),
        "微博热搜助手",
        run_status="failed",
    )
    assert "【任务失败】" in text
    assert "网络超时" in text
