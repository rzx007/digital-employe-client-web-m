from __future__ import annotations

REQUEST_EXTERNAL_DIR_TOOL_NAME = "request_external_dir_access"

EXTERNAL_DIR_INTERRUPT_ON = {
    REQUEST_EXTERNAL_DIR_TOOL_NAME: {"allowed_decisions": ["approve", "reject"]}
}

# 只有 ask 才弹卡；auto/deny 静默由 _run 话术 + 守卫硬底线处理。
_NO_CARD_MODES = frozenset({"auto", "deny"})


def strip_external_dir_interrupt(interrupt_on: dict, mode: str) -> dict:
    """按会话外部目录模式决定是否保留 request_external_dir_access 的 interrupt 登记。

    - mode ∈ {auto, deny}：返回去掉 request_external_dir_access 的副本（不挂起、不弹卡，
      工具直接 _run 返回 mode 相应话术；越界写入由守卫硬底线处理）。
    - 其他（ask / 取不到 / 异常）：原样返回（保留弹卡，安全默认）。
    """
    if mode in _NO_CARD_MODES and REQUEST_EXTERNAL_DIR_TOOL_NAME in interrupt_on:
        stripped = dict(interrupt_on)
        stripped.pop(REQUEST_EXTERNAL_DIR_TOOL_NAME, None)
        return stripped
    return interrupt_on


def build_request_external_dir_tool(mode: str = "ask"):
    """构造申请工作区外目录写授权的工具。

    mode 决定 _run 回执话术：
    - auto：已自动放行，直接重试写入即可，无需逐次授权。
    - deny：硬拒绝，授权请求被自动拒绝，请勿再申请。
    - ask（默认）：该工具登记在 interrupt_on，调用前会被挂起等用户在卡片上选择，
      resume 后 approve handler 已按 scope 记好授权，这里只回执。
    """
    from langchain_core.tools import StructuredTool

    def _run(path: str, reason: str = "") -> str:
        if mode == "auto":
            return (
                "目录模式=自动：工作区外写入已自动放行，"
                "请直接重试写入，无需逐次授权。"
            )
        if mode == "deny":
            return (
                "目录模式=严禁：禁止写入工作区外目录，授权请求被自动拒绝。"
                "请勿再申请，改用工作区内路径，或提示用户切换目录模式。"
            )
        # ask（含 post-approve resume）：以用户在卡片上的选择为准。
        return f"已处理对 {path} 的授权请求（以用户在卡片上的选择为准）。获批则可重试写入。"

    return StructuredTool.from_function(
        name=REQUEST_EXTERNAL_DIR_TOOL_NAME,
        description=(
            "申请写入工作区外目录的授权。当 write_file/edit_file 因目标在工作区外被挡回时，"
            "用目标所在的父目录路径调用本工具，等待用户授权后再重试写入。"
        ),
        func=_run,
    )
