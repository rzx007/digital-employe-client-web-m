from sqlalchemy import select
from src.models.conversation import ConversationMessage
from src.models.plan_run import PlanRun
from src.service.orchestrator_execution_summary import resolve_assistant_delivery_text

_MAX = 3000


def build_channel_report(db, row) -> str:
    if row.plan_run_id is None:
        last = db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == row.conversation_id,
                   ConversationMessage.role == "assistant")
            .order_by(ConversationMessage.id.desc())
        ).first()
        body = resolve_assistant_delivery_text(last) or "（无文本回复）"
        return _clip(body)

    run = db.get(PlanRun, row.plan_run_id)
    from src.service.orchestration_lifecycle import collect_plan_deliverables
    delivs = collect_plan_deliverables(db, run.plan_id, run_id=run.id) if run else []
    lines = ["【执行完成】" if run and run.status == "settled" else "【执行结束】"]
    lines.append(f"指令：{_clip(row.text or '', 80)}")
    if delivs:
        names = "、".join(d["basename"] for d in delivs)
        lines.append(f"交付物：{names}")
    else:
        lines.append("交付物：（无）")
    return _clip("\n".join(lines))


def _clip(s: str, n: int = _MAX) -> str:
    return s if len(s) <= n else s[:n] + "…（详见客户端）"
