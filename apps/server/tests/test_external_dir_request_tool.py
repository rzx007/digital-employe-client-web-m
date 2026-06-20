from src.service.agent.external_dir_request_tool import (
    REQUEST_EXTERNAL_DIR_TOOL_NAME, EXTERNAL_DIR_INTERRUPT_ON,
)


def test_tool_name_and_interrupt_registered():
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME == "request_external_dir_access"
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in EXTERNAL_DIR_INTERRUPT_ON
    assert "approve" in EXTERNAL_DIR_INTERRUPT_ON[REQUEST_EXTERNAL_DIR_TOOL_NAME]["allowed_decisions"]
    assert "reject" in EXTERNAL_DIR_INTERRUPT_ON[REQUEST_EXTERNAL_DIR_TOOL_NAME]["allowed_decisions"]


def test_merged_into_hitl_interrupt_on():
    from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in HITL_INTERRUPT_ON


def test_build_tool_has_correct_name():
    from src.service.agent.external_dir_request_tool import build_request_external_dir_tool
    tool = build_request_external_dir_tool()
    assert tool.name == "request_external_dir_access"
