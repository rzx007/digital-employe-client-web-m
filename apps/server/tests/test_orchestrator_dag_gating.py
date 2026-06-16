from src.models.task_execution_log import TaskExecutionLog


def test_execution_log_has_qa_accepted_at_field():
    assert "qa_accepted_at" in TaskExecutionLog.__table__.columns
