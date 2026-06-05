"""自定义 shell_execute 工具：替代 deepagents 内置 execute，支持可选 intent 供 UI 展示。"""

from typing import Annotated

from langchain_core.tools import BaseTool, InjectedToolCallId, StructuredTool
from pydantic import BaseModel, Field, field_validator

from deepagents.backends.protocol import ExecuteResponse
from src.service.skill_shell_backend import SkillAwareShellBackend

INTENT_MAX_LENGTH = 20

# 单次 agent 运行内 shell 执行的硬上限。超过即**拒绝执行**并强制收尾——
# 根因：本地/小模型常陷入「改脚本→跑→报错→再改」失控循环（observed 单流刷到
# 2 万+事件、上下文撑爆 → 每次模型调用都极慢、前端"卡住"）。软提示拦不住它；
# 这里到上限直接不再执行，不用等 60 步递归上限 / 180s 超时，卡顿大幅减少。
# 正常任务跑脚本通常 3~6 次，12 给足余量，只截真正失控的反复跑。
SHELL_EXECUTE_HARD_LIMIT = 12


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
        description="要执行的 shell 命令（须使用系统提示中的真实物理路径，勿用 /skills/ 等虚拟路径）"
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

    # 本次 agent 运行内的 shell 调用计数（闭包；每次构建 agent 重置）。runaway 都
    # 发生在单次 astream 运行内，闭包计数足以拦截。
    _call_count = {"n": 0}

    def _hard_limit_block() -> str | None:
        _call_count["n"] += 1
        if _call_count["n"] > SHELL_EXECUTE_HARD_LIMIT:
            return (
                f"⛔ 已达本次任务的 shell 执行上限（{SHELL_EXECUTE_HARD_LIMIT} 次），"
                "系统已停止脚本执行，以防"
                "「改一点→跑→报错→再改」的失控循环。请**不要再调用 shell_execute**，"
                "直接基于已产出的文件与已有结果给出最终交付内容；"
                "若某方案反复失败，改用更可靠的方式（如直接用 docx/pptx/xlsx 技能，而非手写脚本）。"
            )
        return None

    async def _arun(
        command: str,
        intent: str | None = None,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        del intent
        blocked = _hard_limit_block()
        if blocked is not None:
            return blocked
        response = await shell.aexecute(command, tool_call_id=tool_call_id or None)
        return format_execute_response(response, shell)

    def _run(
        command: str,
        intent: str | None = None,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        del intent, tool_call_id
        blocked = _hard_limit_block()
        if blocked is not None:
            return blocked
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
