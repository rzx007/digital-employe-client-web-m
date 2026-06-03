"""规则检查点（确定性硬门）。

对一次 agent 运行的结果（最终文本 + 工具调用序列 + 是否中断）施加 cases.yaml
里的 expect 规则。纯函数、无副作用、可离线单测——不依赖模型或 DB。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AgentResult:
    """一次 agent 运行的可观测产物。"""

    final_text: str = ""
    tool_calls: list[str] = field(default_factory=list)  # 工具名按调用顺序
    interrupted: bool = False


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str = ""


def _as_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return list(value)


def evaluate_rules(expect: dict, result: AgentResult) -> list[CheckResult]:
    """对单个用例的 expect 块逐条求值。未声明的规则跳过（不产出检查项）。"""
    checks: list[CheckResult] = []
    called = set(result.tool_calls)

    if "tools_called_any" in expect:
        want = _as_list(expect["tools_called_any"])
        hit = [t for t in want if t in called]
        checks.append(
            CheckResult(
                "tools_called_any",
                bool(hit),
                f"需其一 {want}；实际调用 {result.tool_calls}",
            )
        )

    if "tools_called_all" in expect:
        want = _as_list(expect["tools_called_all"])
        missing = [t for t in want if t not in called]
        checks.append(
            CheckResult(
                "tools_called_all",
                not missing,
                f"缺 {missing}" if missing else "全部命中",
            )
        )

    if "tools_not_called" in expect:
        forbidden = _as_list(expect["tools_not_called"])
        violated = [t for t in forbidden if t in called]
        checks.append(
            CheckResult(
                "tools_not_called",
                not violated,
                f"不应调用却调用了 {violated}" if violated else "无违规调用",
            )
        )

    if "interrupted" in expect:
        want = bool(expect["interrupted"])
        checks.append(
            CheckResult(
                "interrupted",
                result.interrupted == want,
                f"期望中断={want}，实际={result.interrupted}",
            )
        )

    if "output_includes" in expect:
        for sub in _as_list(expect["output_includes"]):
            checks.append(
                CheckResult(
                    f"output_includes[{sub}]",
                    sub in result.final_text,
                    "命中" if sub in result.final_text else "未出现",
                )
            )

    if "output_excludes" in expect:
        for sub in _as_list(expect["output_excludes"]):
            checks.append(
                CheckResult(
                    f"output_excludes[{sub}]",
                    sub not in result.final_text,
                    "未出现(好)" if sub not in result.final_text else "不应出现却出现",
                )
            )

    return checks


def rules_passed(checks: list[CheckResult]) -> bool:
    """硬门：所有规则检查点都通过才算过（无规则=空门，视为通过）。"""
    return all(c.passed for c in checks)
