"""Tool for precise current date/time (system prompt only carries day-level date for cache)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

DEFAULT_TIMEZONE = "Asia/Shanghai"


class GetCurrentTimeInput(BaseModel):
    timezone: str | None = Field(
        default=None,
        description=(
            "IANA 时区名，默认 Asia/Shanghai（北京时间 UTC+8）。"
            "例：America/New_York、Europe/London"
        ),
    )


def resolve_timezone_name(timezone: str | None) -> str:
    name = (timezone or DEFAULT_TIMEZONE).strip()
    return name or DEFAULT_TIMEZONE


def format_current_time(*, timezone: str | None = None) -> str:
    tz_name = resolve_timezone_name(timezone)
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return (
            f"未知时区: {tz_name!r}。请使用 IANA 时区名，例如 {DEFAULT_TIMEZONE}。"
        )
    now = datetime.now(tz)
    offset = now.strftime("%z")
    offset_label = f"UTC{offset[:3]}:{offset[3:]}" if offset else "UTC"
    weekday_names = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")
    weekday = weekday_names[now.weekday()]
    return (
        f"当前时间: {now.strftime('%Y-%m-%d %H:%M:%S')} "
        f"({weekday}, {tz_name}, {offset_label})"
    )


def get_current_time(timezone: str | None = None) -> str:
    """Return human-readable current time for agent tool calls."""
    return format_current_time(timezone=timezone)


get_current_time_tool = StructuredTool.from_function(
    func=get_current_time,
    name="get_current_time",
    description=(
        "获取当前精确日期与时间（含时分秒、星期与时区）。"
        "用户问「现在几点」「今天星期几」、需要 cron/定时/截止时间或相对时间计算时调用；"
        "系统提示里只有日期（不含时分秒），精确时间必须靠本工具。"
    ),
    args_schema=GetCurrentTimeInput,
)
