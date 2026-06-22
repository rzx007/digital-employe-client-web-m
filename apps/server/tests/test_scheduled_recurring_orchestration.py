from src.models.task_execution_log import TaskExecutionLog
from src.models.orchestration_plan import OrchestrationPlan


def test_execution_log_has_run_id_column():
    assert "run_id" in TaskExecutionLog.__table__.columns


def test_plan_has_cron_and_recurring_columns():
    cols = OrchestrationPlan.__table__.columns
    for name in ("cron", "is_recurring", "last_run_at", "next_run_at"):
        assert name in cols, name


def test_plan_run_table_exists():
    from src.models.plan_run import PlanRun
    for name in ("plan_id", "run_seq", "trigger", "auto_accept", "status"):
        assert name in PlanRun.__table__.columns, name
