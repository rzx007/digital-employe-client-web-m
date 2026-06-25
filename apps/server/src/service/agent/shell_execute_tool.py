"""自定义 shell_execute 工具：替代 deepagents 内置 execute，支持可选 intent 供 UI 展示，
以及 timeout / run_in_background 转后台。配套 shell_poll / shell_wait / shell_kill 管理后台命令。"""

from typing import Annotated

from langchain_core.tools import BaseTool, InjectedToolCallId, StructuredTool
from pydantic import BaseModel, Field, field_validator

from deepagents.backends.protocol import ExecuteResponse
from src.service.skill_shell_backend import SkillAwareShellBackend

INTENT_MAX_LENGTH = 20
DEFAULT_FOREGROUND_TIMEOUT = 60


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
    timeout: int | None = Field(
        default=None,
        description=(
            "可选：前台等待上限（秒）。一般命令不用传（默认 60，几秒内完成的会同步返回）；"
            "仅预判长任务（扫盘/编译/下载/拉镜像）时才传较大值（如 120-300）让它前台多等。"
            "超时仍未完成则自动转后台、返回 session_id（输出不丢失），"
            "随后用 shell_wait(session_id) 有节奏地等结果、shell_kill(session_id) 终止。"
        ),
    )
    run_in_background: bool = Field(
        default=False,
        description=(
            "可选：直接后台运行（不等前台）。预判是长任务（拉镜像/全盘扫描/大型编译）时设 True，"
            "立即返回 session_id 你可同一轮里去做别的，再用 shell_wait/shell_poll 取结果、"
            "shell_kill 终止。普通会很快结束的命令**不要**设（设了反而看不到即时结果）。"
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
        timeout: int | None = None,
        run_in_background: bool = False,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        response = await shell.aexecute(
            command,
            timeout=timeout if timeout is not None else DEFAULT_FOREGROUND_TIMEOUT,
            tool_call_id=tool_call_id or None,
            allow_background=True,
            run_in_background=run_in_background,
            intent=intent,
        )
        return format_execute_response(response, shell)

    def _run(
        command: str,
        intent: str | None = None,
        timeout: int | None = None,
        run_in_background: bool = False,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        del intent, tool_call_id, timeout, run_in_background
        return format_execute_response(shell.execute(command), shell)

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="shell_execute",
        description=(
            "在 shell 中执行命令（替代 execute）。command 为实际命令；"
            "intent 可选：20字内中文业务目的，勿含文件名或「执行 xxx」。"
            "一般命令直接调、不传 timeout（默认 60s 内同步返回）；"
            "预判是长任务就传较大 timeout 或 run_in_background=True 转后台，"
            "拿到 session_id 后用 shell_wait 有节奏等结果，别空轮询、别杀了重试。"
            f"{artifacts_hint}"
            "交付给用户的 .docx/.xlsx 等二进制须 python 生成并 save 到产物目录；"
            "勿假设 listdir('.') 能扫到 save 到其他盘符路径的文件。"
        ),
        args_schema=ShellExecuteInput,
    )


def create_shell_poll_tool() -> BaseTool:
    from src.service.shell_background_registry import get_background_shell_registry

    class _PollInput(BaseModel):
        session_id: str = Field(description="shell_execute 转后台/后台运行返回的 session_id")
        offset: int | None = Field(
            default=None, description="可选：从该字节偏移继续读，默认接上次"
        )

    def _poll(session_id: str, offset: int | None = None) -> str:
        r = get_background_shell_registry().poll(session_id, from_offset=offset)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}（可能已结束并被回收）。"
        status = "运行中" if r["running"] else f"已结束(exit_code={r['exit_code']})"
        body = r["new_output"] or "(无新增输出)"
        return f"[{status}] 新增输出:\n{body}\n[offset={r['offset']}]"

    return StructuredTool.from_function(
        func=_poll,
        name="shell_poll",
        args_schema=_PollInput,
        description=(
            "快速查询一次后台运行的命令：返回新增 stdout、是否仍在运行、退出码。"
            "只查一眼用它；要**等结果**请用 shell_wait（阻塞等一轮），勿用 poll 空轮询。"
        ),
    )


def create_shell_wait_tool() -> BaseTool:
    from src.service.shell_background_registry import get_background_shell_registry

    class _WaitInput(BaseModel):
        session_id: str = Field(description="shell_execute 转后台/后台运行返回的 session_id")
        max_seconds: int = Field(
            default=60,
            ge=1,
            le=300,
            description="本轮最多阻塞等待的秒数（命令提前结束则立即返回；上限300）",
        )

    def _wait(session_id: str, max_seconds: int = 60) -> str:
        r = get_background_shell_registry().wait(session_id, max_seconds)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}（可能已结束并被回收）。"
        body = r["new_output"] or "(无新增输出)"
        if r["finished"]:
            return (
                f"[已结束(exit_code={r['exit_code']})] 等待 {r['waited_seconds']}s。"
                f"新增输出:\n{body}\n[offset={r['offset']}]"
            )
        return (
            f"[仍在运行] 已等待 {r['waited_seconds']}s 未完成。新增输出:\n{body}\n"
            f"[offset={r['offset']}] 可再 shell_wait 等一轮；若判断是超大任务，"
            f"告诉用户「已在后台运行，可在后台命令面板查看或稍后问我进度」并体面收尾，勿杀了重试。"
        )

    return StructuredTool.from_function(
        func=_wait,
        name="shell_wait",
        args_schema=_WaitInput,
        description=(
            "阻塞等待后台命令结束、或最多 max_seconds 秒（上限300）。"
            "转后台后**有节奏地等结果优先用它**（每轮如 30-60s），命令完成即返回最终输出与退出码；"
            "未完成可再调一轮。不要用空轮询 shell_poll 来等。"
        ),
    )


def create_shell_kill_tool() -> BaseTool:
    from src.service.shell_background_registry import get_background_shell_registry

    class _KillInput(BaseModel):
        session_id: str = Field(description="要终止的后台命令 session_id")

    def _kill(session_id: str) -> str:
        r = get_background_shell_registry().kill(session_id)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}。"
        return (
            f"已终止后台命令 session_id={session_id}。"
            if r["killed"]
            else "命令已先行结束，无需终止。"
        )

    return StructuredTool.from_function(
        func=_kill,
        name="shell_kill",
        args_schema=_KillInput,
        description="终止后台运行的命令（杀整个进程组）。",
    )
