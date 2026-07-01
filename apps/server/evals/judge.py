"""rubric LLM 裁判（软分）。

单裁判 + 单条 rubric，只评**终态**（最终回复 + 工具调用轨迹），输出 1-5 分。
文档依据：单裁判 + rubric 优于多裁判面板；评终态不评过程。

裁判模型复用 build_chat_model（与业务同一出口）。score 解析与 prompt 构造
是纯函数，可离线单测；真正打分需要可用的模型端点。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from evals.checks import AgentResult

_JUDGE_SYSTEM = (
    "你是严格的评测裁判。根据给定 rubric 对数字员工的**单轮表现**打分，"
    "只看最终结果与它实际调用的工具，不臆测过程。"
    "输出格式必须是一行：`分数: <1-5 整数> | 理由: <一句话>`。"
    "1=完全不符合 rubric，3=部分符合，5=完全符合。"
)

_JUDGE_USER_TEMPLATE = """## 评分标准(rubric)
{rubric}

## 用户输入
{user_input}

## 数字员工最终回复
{final_text}

## 它本轮实际调用的工具（按顺序）
{tool_calls}

## 是否触发了人工确认中断(HITL)
{interrupted}

请按 `分数: <1-5> | 理由: <一句话>` 输出。"""


@dataclass
class JudgeVerdict:
    score: int  # 1-5；0 表示解析失败
    reason: str = ""
    raw: str = ""


def build_judge_messages(
    rubric: str, user_input: str, result: AgentResult
) -> list[dict]:
    """构造裁判消息（纯函数，便于离线断言）。"""
    user = _JUDGE_USER_TEMPLATE.format(
        rubric=rubric.strip(),
        user_input=user_input.strip(),
        final_text=(result.final_text or "（无文本输出）").strip(),
        tool_calls=", ".join(result.tool_calls) or "（未调用任何工具）",
        interrupted="是" if result.interrupted else "否",
    )
    return [
        {"role": "system", "content": _JUDGE_SYSTEM},
        {"role": "user", "content": user},
    ]


def parse_judge_output(text: str) -> JudgeVerdict:
    """从裁判输出里抽取 1-5 分与理由；解析失败返回 score=0。"""
    raw = (text or "").strip()
    m = re.search(r"分数[:：]\s*([1-5])", raw)
    if not m:
        # 退路：取首个孤立的 1-5 数字
        m2 = re.search(r"\b([1-5])\b", raw)
        if not m2:
            return JudgeVerdict(0, "无法解析分数", raw)
        score = int(m2.group(1))
    else:
        score = int(m.group(1))
    rm = re.search(r"理由[:：]\s*(.+)", raw)
    reason = rm.group(1).strip() if rm else ""
    return JudgeVerdict(score, reason, raw)


def judge_case(
    rubric: str, user_input: str, result: AgentResult, *, model=None
) -> JudgeVerdict:
    """实际打分：调用模型。model 为 None 时用 build_chat_model() 现起一个。"""
    if model is None:
        from src.llm.factory import build_chat_model

        model = build_chat_model(temperature=0)
    messages = build_judge_messages(rubric, user_input, result)
    resp = model.invoke(messages)
    content = getattr(resp, "content", resp)
    if isinstance(content, list):  # 某些 provider 返回 parts
        content = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in content
        )
    return parse_judge_output(str(content))
