from __future__ import annotations

REQUEST_EXTERNAL_DIR_TOOL_NAME = "request_external_dir_access"

EXTERNAL_DIR_INTERRUPT_ON = {
    REQUEST_EXTERNAL_DIR_TOOL_NAME: {"allowed_decisions": ["approve", "reject"]}
}


def build_request_external_dir_tool():
    from langchain_core.tools import StructuredTool

    def _run(path: str, reason: str = "") -> str:
        # 该工具登记在 interrupt_on，调用前会被挂起等用户授权；
        # resume 后 approve handler 已按 scope 记好授权，这里只回执。
        return f"已处理对 {path} 的授权请求（以用户在卡片上的选择为准）。获批则可重试写入。"

    return StructuredTool.from_function(
        name=REQUEST_EXTERNAL_DIR_TOOL_NAME,
        description=(
            "申请写入工作区外目录的授权。当 write_file/edit_file 因目标在工作区外被挡回时，"
            "用目标所在的父目录路径调用本工具，等待用户授权后再重试写入。"
        ),
        func=_run,
    )
