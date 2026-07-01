from __future__ import annotations

from langchain_core.tools import tool

CLARIFYING_QUESTIONS_INTERRUPT_ON = {
    "submit_clarifying_questions": {
        "allowed_decisions": ["respond", "reject"],
    },
}


@tool
def submit_clarifying_questions(
    context: str,
    questions: str = "[]",
) -> str:
    """向用户提出澄清问题并等待作答（同一次澄清轮次仅调用一次）。

    用于需求模糊、信息不足时先收集用户答案，再进入后续规划或执行。
    前端在输入框上方以分页 Questions 展示；用户 Skip 将终止本轮对话。

    Args:
        context: 场景标识，如 long_document（长文档）、general（通用模糊任务）。
        questions: JSON 字符串，问题列表。每项建议含：
            - id: 唯一标识
            - prompt: 问题文案
            - required: 是否必填（可选，默认 false）
            - type: "choice" | "text"（可选；有 options 时自动为 choice）
            - options: 选择题选项字符串数组（展示为 A/B/C…）

            前端对 choice 题在选项下方提供手填输入框；用户手填时 respond 文本为「其他：…」。
            不必每题都加「其他」选项，3～6 个具体选项即可。

            例: '[{"id":"q1","prompt":"读者是谁？","required":true,"type":"choice","options":["内部技术方案","对外标书"]}]'

    用户通过 respond 提交答案后，你会收到 ToolMessage 中的作答内容；
    长文档场景下应再调用 submit_document_plan，禁止在澄清完成前 write_file 到 /artifacts/。
    """
    return f"已收到用户对 {context} 场景澄清问题的回答，请继续后续步骤。"
