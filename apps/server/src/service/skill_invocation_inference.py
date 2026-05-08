"""从会话助手消息的 chunk 与上一条用户消息推断本次调用涉及的技能目录名（与 EmployeeSkill.skill_name 对应）。"""

from __future__ import annotations

import json
import re
from typing import Any

# 虚拟路径 /skills/<skill-folder>/...（与 agent 中 skills 挂载一致）
_SKILLS_POSIX_RE = re.compile(r"/skills/([^/\"'\s\\]+)")
# Windows 风格路径中的 skills 子目录
_SKILLS_WIN_RE = re.compile(r"\\skills\\([^\\\"'\s]+)", re.IGNORECASE)
# 流式接口中注入的提示：请使用 xxx 技能回答这个问题
_USER_SKILL_HINT_RE = re.compile(r"请使用(.+?)技能")


def _walk_collect_strings(obj: Any, out: list[str]) -> None:
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _walk_collect_strings(v, out)
    elif isinstance(obj, list):
        for item in obj:
            _walk_collect_strings(item, out)


def _extract_folder_names_from_text(text: str) -> set[str]:
    names: set[str] = set()
    for pattern in (_SKILLS_POSIX_RE, _SKILLS_WIN_RE):
        for m in pattern.finditer(text):
            seg = m.group(1).strip()
            if seg:
                names.add(seg)
    return names


def infer_skill_folder_names_from_user_content(content: str | None) -> set[str]:
    if not content:
        return set()
    names: set[str] = set()
    for m in _USER_SKILL_HINT_RE.finditer(content):
        raw = m.group(1).strip()
        if raw:
            names.add(raw)
    names |= _extract_folder_names_from_text(content)
    return names
