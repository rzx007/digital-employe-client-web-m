from src.db.base import Base
from src.db.session import get_engine
from sqlalchemy import inspect, text
import logging

logger = logging.getLogger(__name__)

# Ensure model metadata is registered.
from src import models  # noqa: F401  pylint: disable=unused-import


def init_db() -> None:
    # 新项目=新空库：直接从 models 一步建全 schema，无历史库可升级。
    engine = get_engine()
    Base.metadata.create_all(bind=engine)

    # workspaces 表：幂等加列（已有库不会被 create_all 自动 ALTER）
    _ensure_workspace_auto_grant_column(engine)

    # 定时递归编排特性新增列：幂等补齐已有库
    _ensure_orchestration_recurring_columns(engine)

    # PlanRun 机制引入前已 confirmed 的老 plan + 它们的 logs：幂等回填
    _backfill_plan_runs_for_legacy_plans(engine)

    # FTS5 全文索引：conversation_messages.content
    _init_fts5(engine)

    # 启动时清理上次进程遗留的"运行中"流状态。
    _reset_orphaned_streams(engine)


def _ensure_orchestration_recurring_columns(engine) -> None:
    """幂等为已有库补「定时递归编排」特性新增列。

    新库由 create_all 直接建全；已有库不会被 create_all ALTER，需在此补列：
    - task_execution_logs.run_id
    - orchestration_plans.cron / is_recurring / last_run_at / next_run_at
    - orchestration_plans.schedule_kind / run_at
    - plan_runs.conversation_id（plan_runs 表由 create_all 建出，但此列后期添加）
    """
    insp = inspect(engine)
    tel_cols = {c["name"] for c in insp.get_columns("task_execution_logs")}
    op_cols = {c["name"] for c in insp.get_columns("orchestration_plans")}
    pr_cols = {c["name"] for c in insp.get_columns("plan_runs")}
    with engine.begin() as conn:
        if "run_id" not in tel_cols:
            conn.execute(text("ALTER TABLE task_execution_logs ADD COLUMN run_id INTEGER"))
            logger.info("added column task_execution_logs.run_id")
        if "cron" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN cron VARCHAR(128)"))
            logger.info("added column orchestration_plans.cron")
        if "is_recurring" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN is_recurring BOOLEAN NOT NULL DEFAULT 0"))
            logger.info("added column orchestration_plans.is_recurring")
        if "last_run_at" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN last_run_at DATETIME"))
            logger.info("added column orchestration_plans.last_run_at")
        if "next_run_at" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN next_run_at DATETIME"))
            logger.info("added column orchestration_plans.next_run_at")
        if "schedule_kind" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN schedule_kind VARCHAR(16)"))
            logger.info("added column orchestration_plans.schedule_kind")
        if "run_at" not in op_cols:
            conn.execute(text("ALTER TABLE orchestration_plans ADD COLUMN run_at DATETIME"))
            logger.info("added column orchestration_plans.run_at")
        if "conversation_id" not in pr_cols:
            conn.execute(text("ALTER TABLE plan_runs ADD COLUMN conversation_id INTEGER"))
            logger.info("added column plan_runs.conversation_id")


def _ensure_workspace_auto_grant_column(engine) -> None:
    """幂等地为 workspaces 表加 auto_grant_external_dirs 列。

    新库由 create_all 直接建全；已有库不会被 ALTER，需在此补列。
    """
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("workspaces")}
    if "auto_grant_external_dirs" not in cols:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE workspaces ADD COLUMN auto_grant_external_dirs "
                "BOOLEAN NOT NULL DEFAULT 0"
            ))
        logger.info("added column workspaces.auto_grant_external_dirs")


def _backfill_plan_runs_for_legacy_plans(engine) -> None:
    """幂等回填：为 PlanRun 机制引入前 confirmed 但无 PlanRun 的老 plan 补一条 settled run，
    并把它们属下的 TaskExecutionLog.run_id（NULL）更新到该 run，让 today-tasks 折叠聚合能
    正确读到历史状态而非误判为 pending。

    新建的 plan 走 execute_plan / run_plan_job 都会开 PlanRun，不受影响。本 helper 只补老数据。
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    required = {"orchestration_plans", "plan_runs", "task_execution_logs", "employee_tasks"}
    if not required.issubset(tables):
        return

    with engine.begin() as conn:
        # 找所有 confirmed 但还没任何 PlanRun 的老 plan
        rows = conn.execute(text("""
            SELECT p.id, p.workspace_id, p.created_at, p.conversation_id
            FROM orchestration_plans p
            LEFT JOIN plan_runs r ON r.plan_id = p.id
            WHERE p.status = 'confirmed' AND r.id IS NULL
            GROUP BY p.id
        """)).all()
        if not rows:
            return
        backfilled = 0
        for plan_id, workspace_id, created_at, plan_conv_id in rows:
            # 建一条 settled PlanRun（trigger=manual 保守，auto_accept=False 保留交互式语义）；
            # conversation_id 用 plan 创建源会话，让 today 面板该行点击可跳。
            conn.execute(text("""
                INSERT INTO plan_runs (plan_id, workspace_id, run_seq, trigger, auto_accept,
                                       status, conversation_id, started_at, ended_at, created_at)
                VALUES (:pid, :wid, 1, 'manual', 0, 'settled', :conv, :ts, :ts, :ts)
            """), {"pid": plan_id, "wid": workspace_id, "conv": plan_conv_id, "ts": created_at})
            new_run_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()
            # 把该 plan 属下子任务的 logs（run_id 为 NULL 的）全部归到这条新 run
            conn.execute(text("""
                UPDATE task_execution_logs
                SET run_id = :rid
                WHERE run_id IS NULL AND task_id IN (
                    SELECT id FROM employee_tasks WHERE orchestration_plan_id = :pid
                )
            """), {"rid": new_run_id, "pid": plan_id})
            backfilled += 1
        if backfilled:
            logger.info("backfilled %s legacy plan(s) with PlanRun + logs.run_id", backfilled)


def _reset_orphaned_streams(engine) -> None:
    """启动时清理上次进程遗留的"运行中"流状态。

    后端重启/崩溃会让正在跑的流被打断，但 DB 里的
    conversation_messages.stream_state='streaming'、
    task_execution_logs.run_status in ('running','queued')、
    conversations.status='running' 会永久卡死，导致：
    - 群协作的完成事件永不触发 → 后续任务永远不派发；
    - 前端一直转圈。
    这里把它们重置为终态（中断/失败），让链路可恢复、不卡死。
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        if "conversation_messages" in tables:
            cols = {c["name"] for c in inspector.get_columns("conversation_messages")}
            if "stream_state" in cols:
                r = conn.execute(text(
                    "UPDATE conversation_messages SET stream_state='error' "
                    "WHERE stream_state IN ('streaming','queued')"
                ))
                if getattr(r, "rowcount", 0):
                    logger.info("reset %s orphaned streaming messages", r.rowcount)
        if "task_execution_logs" in tables:
            cols = {c["name"] for c in inspector.get_columns("task_execution_logs")}
            if "run_status" in cols:
                r = conn.execute(text(
                    "UPDATE task_execution_logs SET run_status='failed', "
                    "run_result='进程重启中断' "
                    "WHERE run_status IN ('running','queued')"
                ))
                if getattr(r, "rowcount", 0):
                    logger.info("reset %s orphaned running task logs", r.rowcount)
        if "conversations" in tables:
            cols = {c["name"] for c in inspector.get_columns("conversations")}
            if "status" in cols:
                conn.execute(text(
                    "UPDATE conversations SET status='idle' "
                    "WHERE status IN ('running','interrupted')"
                ))


def _init_fts5(engine) -> None:
    """为 conversation_messages.content 创建 FTS5 全文索引。"""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS conversation_messages_fts
            USING fts5(content, content='conversation_messages', content_rowid='id', tokenize='unicode61')
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS cm_fts_insert AFTER INSERT ON conversation_messages
            BEGIN
                INSERT INTO conversation_messages_fts(rowid, content) VALUES (new.id, new.content);
            END
        """))
        conn.execute(text(
            "INSERT INTO conversation_messages_fts(conversation_messages_fts) VALUES('rebuild')"
        ))
        conn.commit()
