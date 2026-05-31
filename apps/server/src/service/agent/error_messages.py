"""将 Agent / LLM 异常转为用户可读的中文说明。"""

from __future__ import annotations


def _active_model_label() -> str:
    from src.core.config import get_settings

    settings = get_settings()
    model = (settings.deepagent_model or "").strip() or "未配置"
    provider = (settings.llm_provider or "").strip()
    if provider:
        return f"{model}（供应商：{provider}）"
    return model


def format_agent_error_for_user(exc: BaseException | str) -> str:
    """统一 Agent 流式错误文案：中文 + 当前模型信息（若相关）。"""
    raw = str(exc).strip() if exc is not None else ""
    if not raw:
        return "任务执行失败，请稍后重试。"

    lower = raw.lower()
    model_label = _active_model_label()

    if "connection error" in lower or lower == "connection error.":
        return (
            f"无法连接当前语言模型 {model_label}。"
            f"请检查设置中的 API Key、Base URL 与模型名称是否正确，或稍后重试。"
        )
    if "connection refused" in lower or "connect error" in lower:
        return f"无法连接模型服务 {model_label}，请检查网络与 Base URL。"
    if "timed out" in lower or "timeout" in lower:
        return f"请求模型 {model_label} 超时，请稍后重试。"
    if "401" in raw or "unauthorized" in lower or "invalid api key" in lower:
        return f"模型 {model_label} 鉴权失败，请检查 API Key。"
    if "404" in raw and "model" in lower:
        return f"模型 {model_label} 不存在或当前供应商不支持，请在设置中更换模型。"
    if "tool result too large" in lower:
        return (
            "工具返回内容过大，已写入内部缓存。"
            "请缩小查询范围（例如只查单个员工、不要拉取完整技能正文），"
            "或使用 update_employee 直接传入 skill_ids。"
        )
    if raw.startswith("错误") or raw.startswith("错误：") or raw.startswith("错误:"):
        return raw

    return raw
