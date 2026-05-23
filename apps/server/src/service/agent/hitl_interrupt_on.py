from __future__ import annotations

from src.service.agent.clarifying_questions_tool import CLARIFYING_QUESTIONS_INTERRUPT_ON
from src.service.agent.document_plan_tool import DOCUMENT_PLAN_INTERRUPT_ON

HITL_INTERRUPT_ON = {
    **CLARIFYING_QUESTIONS_INTERRUPT_ON,
    **DOCUMENT_PLAN_INTERRUPT_ON,
}
