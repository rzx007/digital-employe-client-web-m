"""将本机绝对路径文件导入会话 /uploads/ 的 Agent 工具。"""

from typing import Annotated

from langchain_core.tools import BaseTool, InjectedToolCallId, StructuredTool
from pydantic import BaseModel, Field

from src.service.resource_service import ResourceService
from src.service.local_file_import import is_host_absolute_path, normalize_host_path


class ImportLocalFileInput(BaseModel):
    local_path: str = Field(
        description=(
            "本机文件的绝对路径（支持 ~ 展开），"
            "如 C:\\Users\\x\\file.md 或 /Users/x/file.md"
        )
    )


def create_import_local_file_tool(
    *,
    root_path: str,
    conversation_id: int | None,
) -> BaseTool:
    def _import(local_path: str, tool_call_id: Annotated[str, InjectedToolCallId] = "") -> str:
        del tool_call_id
        if conversation_id is None:
            return "错误：当前无会话，无法导入本机文件。"

        if not is_host_absolute_path(local_path):
            return (
                "错误：请提供本机绝对路径（如 C:\\Users\\... 或 /home/...），"
                "不要使用 /uploads/ 等虚拟路径。"
            )

        try:
            resolved = normalize_host_path(local_path)
        except (OSError, ValueError) as exc:
            return f"错误：无法解析路径 {local_path!r}: {exc}"

        outcome = ResourceService.import_local_file(
            root_path,
            conversation_id,
            resolved,
        )
        if isinstance(outcome, str):
            return f"错误：{outcome}"

        return (
            f"已导入：{outcome.path}（源：{resolved}）。"
            f"请使用 read_file(\"{outcome.path}\") 读取内容。"
        )

    return StructuredTool.from_function(
        func=_import,
        name="import_local_file",
        description=(
            "将用户本机磁盘上的文件复制到当前会话 /uploads/，"
            "以便用 read_file 读取。适用于 C:\\...、/Users/...、/home/... 等路径。"
        ),
        args_schema=ImportLocalFileInput,
    )
