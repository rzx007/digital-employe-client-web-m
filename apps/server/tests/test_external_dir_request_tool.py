from src.service.agent.external_dir_request_tool import (
    REQUEST_EXTERNAL_DIR_TOOL_NAME,
    EXTERNAL_DIR_INTERRUPT_ON,
    build_request_external_dir_tool,
    strip_external_dir_interrupt,
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
    tool = build_request_external_dir_tool()
    assert tool.name == "request_external_dir_access"


# ---------------------------------------------------------------------------
# strip_external_dir_interrupt：auto/deny 移除，ask/未知 保留
# ---------------------------------------------------------------------------


def _sample_interrupt_on() -> dict:
    return {
        REQUEST_EXTERNAL_DIR_TOOL_NAME: {"allowed_decisions": ["approve", "reject"]},
        "submit_clarifying_questions": {"allowed_decisions": ["approve", "reject"]},
    }


def test_strip_removes_request_tool_when_auto():
    result = strip_external_dir_interrupt(_sample_interrupt_on(), "auto")
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME not in result
    assert "submit_clarifying_questions" in result


def test_strip_removes_request_tool_when_deny():
    result = strip_external_dir_interrupt(_sample_interrupt_on(), "deny")
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME not in result
    assert "submit_clarifying_questions" in result


def test_strip_keeps_request_tool_when_ask():
    result = strip_external_dir_interrupt(_sample_interrupt_on(), "ask")
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in result


def test_strip_keeps_request_tool_when_unknown_mode():
    # 取不到/异常默认 ask 之外的未知值也按安全默认保留弹卡
    result = strip_external_dir_interrupt(_sample_interrupt_on(), "bogus")
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in result


def test_strip_does_not_mutate_input():
    original = _sample_interrupt_on()
    strip_external_dir_interrupt(original, "auto")
    assert REQUEST_EXTERNAL_DIR_TOOL_NAME in original


# ---------------------------------------------------------------------------
# build_request_external_dir_tool(mode) 的 _run 按 mode 返回对应话术
# ---------------------------------------------------------------------------


def _invoke(tool, **kwargs) -> str:
    return tool.func(**kwargs)


def test_run_auto_message():
    tool = build_request_external_dir_tool("auto")
    msg = _invoke(tool, path="/tmp/x", reason="r")
    assert "自动" in msg
    assert "自动放行" in msg


def test_run_deny_message():
    tool = build_request_external_dir_tool("deny")
    msg = _invoke(tool, path="/tmp/x", reason="r")
    assert "严禁" in msg
    assert "自动拒绝" in msg


def test_run_ask_message_default():
    tool = build_request_external_dir_tool()  # 默认 ask
    msg = _invoke(tool, path="/tmp/x")
    assert "/tmp/x" in msg
    assert "卡片" in msg


def test_run_ask_message_explicit():
    tool = build_request_external_dir_tool("ask")
    msg = _invoke(tool, path="/tmp/y")
    assert "/tmp/y" in msg
    assert "卡片" in msg
