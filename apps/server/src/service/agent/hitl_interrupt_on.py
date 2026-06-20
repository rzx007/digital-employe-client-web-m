from __future__ import annotations

from src.service.agent.clarifying_questions_tool import CLARIFYING_QUESTIONS_INTERRUPT_ON
from src.service.agent.document_plan_tool import DOCUMENT_PLAN_INTERRUPT_ON
from src.service.agent.bug_report_tool import BUG_REPORT_INTERRUPT_ON
from src.service.agent.external_dir_request_tool import EXTERNAL_DIR_INTERRUPT_ON

HITL_INTERRUPT_ON = {
    **CLARIFYING_QUESTIONS_INTERRUPT_ON,
    **DOCUMENT_PLAN_INTERRUPT_ON,
    **BUG_REPORT_INTERRUPT_ON,
    **EXTERNAL_DIR_INTERRUPT_ON,
}
