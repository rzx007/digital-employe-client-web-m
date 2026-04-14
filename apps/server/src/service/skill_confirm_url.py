from __future__ import annotations

import re
from pathlib import Path


def _clean_and_validate_http_url(raw: str) -> str | None:
    candidate = (raw or "").strip().strip("\"'<>")
    # 常见中文/英文句末标点，避免把标点带进 URL
    candidate = candidate.rstrip("，。；；、,.!?！？")
    if re.match(r"(?i)^https?://", candidate):
        return candidate
    return None


def find_skill_md_path(skills_dir: str, skill_folder_name: str) -> Path | None:
    """在员工 skills 目录下定位某技能的 SKILL.md。"""
    name = (skill_folder_name or "").strip()
    if not name:
        return None
    root = Path(skills_dir.strip()).resolve()
    if not root.is_dir():
        return None
    direct = root / name / "SKILL.md"
    if direct.is_file():
        return direct
    for child in root.iterdir():
        if not child.is_dir():
            continue
        if child.name == name or child.name.lower() == name.lower():
            cand = child / "SKILL.md"
            if cand.is_file():
                return cand
    return None


def parse_confirm_url_from_skill_md(text: str) -> str | None:
    """
    从 SKILL.md 正文中解析「结果确认」链接。

    支持：
    - YAML frontmatter 中 `confirm_url: https://...`
    - 正文 `确认结果链接: https://...` / `确认链接：` / `确认地址：`
    - 正文 `confirm_url: https://...` 或 `confirm_url=https://...`
    """
    text = (text or "").lstrip("\ufeff")
    if not text.strip():
        return None

    fm = re.match(r"^\s*---\s*\r?\n(.*?)\r?\n---\s*", text, re.DOTALL)
    if fm:
        block = fm.group(1)
        m = re.search(r"(?im)^\s*confirm_url\s*[:：]\s*(.+?)\s*$", block)
        if m:
            parsed = _clean_and_validate_http_url(m.group(1))
            if parsed:
                return parsed

    m = re.search(
        r"(?i)确认(?:结果)?(?:链接|地址|URL)\s*[:：]\s*(?:\[.*?\]\()?<?(https?://[^\s\]\)>]+)",
        text,
    )
    if m:
        parsed = _clean_and_validate_http_url(m.group(1))
        if parsed:
            return parsed

    m = re.search(
        r"(?i)confirm_url\s*[:=：]\s*(?:\[.*?\]\()?<?(https?://[^\s\]\)>]+)",
        text,
    )
    if m:
        parsed = _clean_and_validate_http_url(m.group(1))
        if parsed:
            return parsed

    return None


def load_confirm_url_for_skill(skills_dir: str, skill_folder_name: str) -> str | None:
    path = find_skill_md_path(skills_dir, skill_folder_name)
    if path is None:
        return None
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return None
    return parse_confirm_url_from_skill_md(content)
