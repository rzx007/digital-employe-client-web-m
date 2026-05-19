"""自定义 shell_execute 工具：替代 deepagents 内置 execute，支持可选 intent 供 UI 展示。"""

from __future__ import annotations

import asyncio

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from deepagents.backends.protocol import ExecuteResponse
from src.service.skill_shell_backend import SkillAwareShellBackend

INTENT_MAX_LENGTH = 20


def format_execute_response(response: ExecuteResponse) -> str:
    return response.output or " "


class ShellExecuteInput(BaseModel):
    command: str = Field(
        description="要执行的 shell 命令（须使用系统提示中的真实物理路径，勿用 /skills/ 等虚拟路径）"
    )
    intent: str | None = Field(
        default=None,
        max_length=INTENT_MAX_LENGTH,
        description=(
            "可选：界面标题，20字内中文，写正在做的事（如「验证示例代码输出」）。"
            "禁止含文件名(.py/.js等)、路径、「执行」「运行 xxx」"
        ),
    )


def create_shell_execute_tool(shell: SkillAwareShellBackend) -> BaseTool:
    async def _arun(command: str, intent: str | None = None) -> str:
        del intent
        response = await shell.aexecute(command)
        return format_execute_response(response)

    def _run(command: str, intent: str | None = None) -> str:
        del intent
        return format_execute_response(shell.execute(command))

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="shell_execute",
        description=(
            "在 shell 中执行命令（替代 execute）。command 为实际命令；"
            "intent 可选：20字内中文业务目的，勿含文件名或「执行 xxx」。"
        ),
        args_schema=ShellExecuteInput,
    )
