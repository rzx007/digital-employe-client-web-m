"""技能预路由：确定性关键词匹配 -> 软提示（注入用户消息尾部，不碰系统前缀）。"""
from __future__ import annotations

from typing import Iterable

# 内置技能 -> 触发关键词（全小写）。刻意避免「文档/表格」等过宽词，宁可少提示。
SKILL_TRIGGERS: dict[str, tuple[str, ...]] = {
    "bug-reporter": (
        "反馈", "报bug", "报错", "提建议", "吐槽", "问题反馈", "提个意见", "想反馈",
    ),
    "feishu-workbench": ("交易日", "交易日历", "休市", "开市"),
    "pptx": ("ppt", "幻灯片", "演示文稿", "slides", "deck"),
    "html-ppt": ("ppt", "幻灯片", "演示文稿", "slides", "deck"),
    "xlsx": ("excel", "电子表格", "xlsx", "csv"),
    "pdf": ("pdf",),
    "docx": ("word文档", ".docx", "word 文件"),
    "env-steward": (
        "装python", "装node", "缺依赖", "modulenotfound", "pip装不上",
        "配镜像", "环境依赖",
    ),
    "doc-coauthoring": (
        "技术方案", "标书", "投标", "可行性报告", "白皮书", "长报告", "需求文档",
    ),
}


def match_skills(
    user_text: str,
    available_skills: Iterable[str],
    limit: int = 2,
) -> list[str]:
    """返回命中且在 available 内的技能名。

    子串匹配（全小写）；命中分=最长命中关键词长度；按 (命中分降序, 技能名升序)
    稳定排序后取前 limit。无命中返回 []。
    """
    text = (user_text or "").lower()
    avail = set(available_skills)
    scored: list[tuple[int, str]] = []
    for skill, kws in SKILL_TRIGGERS.items():
        if skill not in avail:
            continue
        best = 0
        for kw in kws:
            if kw and kw.lower() in text:
                best = max(best, len(kw))
        if best > 0:
            scored.append((best, skill))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [s for _, s in scored[:limit]]


def build_route_hint(matched: list[str]) -> str:
    """命中技能 -> 软提示串（尾部注入）；空 -> 空串。"""
    if not matched:
        return ""
    names = "、".join(matched)
    return (
        f"\n\n【技能路由提示（系统自动匹配，仅供参考）】本条消息可能匹配技能：{names}。"
        "若相关，请先读对应 /skills/<技能名>/SKILL.md 并按其说明执行；"
        "你判断不相关可忽略本提示。"
    )
