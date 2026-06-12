"""自定义 shell_execute 工具：替代 deepagents 内置 execute，支持可选 intent 供 UI 展示。"""

from typing import Annotated

from langchain_core.tools import BaseTool, InjectedToolCallId, StructuredTool
from pydantic import BaseModel, Field, field_validator

from deepagents.backends.protocol import ExecuteResponse
from src.service.skill_shell_backend import SkillAwareShellBackend

INTENT_MAX_LENGTH = 20


def normalize_shell_intent(value: object) -> str | None:
    """规范化 intent：去引号、截断至 UI 上限，避免因超长导致工具调用失败。"""
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    text = value.strip().strip('"').strip("'").strip()
    if not text:
        return None
    if len(text) > INTENT_MAX_LENGTH:
        return text[:INTENT_MAX_LENGTH]
    return text


def format_execute_response(
    response: ExecuteResponse,
    shell: SkillAwareShellBackend | None = None,
) -> str:
    if shell is not None:
        return shell.format_shell_output(response)
    return response.output or " "


class ShellExecuteInput(BaseModel):
    command: str = Field(
        description="要执行的 shell 命令（路径用真实绝对路径或 $ARTIFACTS_DIR/$SKILLS_DIR 等环境变量）"
    )
    intent: str | None = Field(
        default=None,
        description=(
            "可选：界面标题，20字内中文短语，写正在做的事（如：验证示例代码输出）。"
            "勿加引号；禁止含文件名(.py/.js等)、路径、「执行」「运行 xxx」"
        ),
    )

    @field_validator("intent", mode="before")
    @classmethod
    def _normalize_intent(cls, value: object) -> str | None:
        return normalize_shell_intent(value)


def create_shell_execute_tool(
    shell: SkillAwareShellBackend,
    *,
    artifacts_dir: str = "",
) -> BaseTool:
    artifacts_hint = (
        f" shell 默认 cwd/产物目录: {artifacts_dir}。"
        if artifacts_dir
        else ""
    )

    async def _arun(
        command: str,
        intent: str | None = None,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        del intent
        response = await shell.aexecute(command, tool_call_id=tool_call_id or None)
        return format_execute_response(response, shell)

    def _run(
        command: str,
        intent: str | None = None,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        del intent, tool_call_id
        return format_execute_response(shell.execute(command), shell)

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="shell_execute",
        description=(
            "在 shell 中执行命令（替代 execute）。command 为实际命令；"
            "intent 可选：20字内中文业务目的，勿含文件名或「执行 xxx」。"
            "intent 为纯文本，勿加引号。"
            f"{artifacts_hint}"
            "交付给用户的 .docx/.xlsx 等二进制须 python 生成并 save 到产物目录；"
            "勿假设 listdir('.') 能扫到 save 到其他盘符路径的文件。"
        ),
        args_schema=ShellExecuteInput,
    )
