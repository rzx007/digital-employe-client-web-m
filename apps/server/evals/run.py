"""行为评估集 runner（L2）。

用法（需配置可用的模型端点 DEEPAGENT_MODEL / BASE_URL，与业务同一出口）：

    cd apps/server
    uv run python -m evals.run                 # 跑全部用例
    uv run python -m evals.run --case cron-once-semantics
    uv run python -m evals.run --list          # 只列用例，不跑
    uv run python -m evals.run --out report_before.json

回归门用法：改提示词**前**跑一遍存 report_before.json，改**后**再跑存
report_after.json，对比 rule_pass 数与各 rubric 均分——分数不掉才上线。

注意：本 runner 直接 ainvoke 编译后的 agent 图，捕获最终 messages / 工具调用 /
是否 HITL 中断。它**需要 DB 与真实模型**；结果解析（extract_agent_result）是纯
函数、已离线单测（见 tests/test_evals_dataset.py）。
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

import yaml

from evals.checks import AgentResult, CheckResult, evaluate_rules, rules_passed
from evals.judge import JudgeVerdict, judge_case

CASES_PATH = Path(__file__).parent / "cases.yaml"


def load_cases(path: Path = CASES_PATH) -> list[dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("cases.yaml 顶层必须是用例列表")
    return data


def extract_agent_result(final_state: Any) -> AgentResult:
    """从 agent 终态（langgraph state dict）抽取可评测产物。纯函数、可离线测。

    兼容：
    - final_state["messages"]: list，元素为 LangChain Message 或 dict
    - final_state["__interrupt__"]: 存在即视为本轮触发了 HITL 中断
    """
    if final_state is None:
        return AgentResult()
    interrupted = bool(_get(final_state, "__interrupt__"))
    messages = _get(final_state, "messages") or []

    tool_calls: list[str] = []
    final_text = ""
    for msg in messages:
        for tc in _message_tool_calls(msg):
            name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None)
            if name:
                tool_calls.append(name)
        text = _message_text(msg)
        if text and _message_role(msg) in ("ai", "assistant"):
            final_text = text  # 末条 AI 文本即终态回复
    return AgentResult(
        final_text=final_text, tool_calls=tool_calls, interrupted=interrupted
    )


# --------------------------- state 解析小工具（纯） --------------------------- #


def _get(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _message_tool_calls(msg: Any) -> list:
    tc = _get(msg, "tool_calls")
    if tc:
        return list(tc)
    # OpenAI 风格落在 additional_kwargs
    ak = _get(msg, "additional_kwargs") or {}
    if isinstance(ak, dict) and ak.get("tool_calls"):
        return [
            {"name": (t.get("function") or {}).get("name")}
            for t in ak["tool_calls"]
        ]
    return []


def _message_text(msg: Any) -> str:
    content = _get(msg, "content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in content
        )
    return ""


def _message_role(msg: Any) -> str:
    t = _get(msg, "type") or _get(msg, "role") or ""
    return str(t).lower()


# ------------------------------ 跑单个用例 ------------------------------ #


async def run_case(case: dict) -> dict:
    """跑一个用例并打分。需要可用的模型 + DB（见 _invoke_agent）。"""
    from evals.harness import invoke_agent  # 延迟导入：未配端点时仍可 --list

    result = await invoke_agent(case)
    checks = evaluate_rules(case.get("expect") or {}, result)
    verdict: JudgeVerdict | None = None
    if case.get("rubric"):
        verdict = judge_case(case["rubric"], case.get("input", ""), result)
    return {
        "id": case["id"],
        "category": case.get("category", ""),
        "rule_pass": rules_passed(checks),
        "checks": [vars(c) for c in checks],
        "judge_score": verdict.score if verdict else None,
        "judge_reason": verdict.reason if verdict else "",
        "tool_calls": result.tool_calls,
        "interrupted": result.interrupted,
        "final_text": result.final_text[:500],
    }


async def run_all(cases: list[dict]) -> list[dict]:
    results = []
    for case in cases:
        try:
            results.append(await run_case(case))
        except Exception as exc:  # 单例失败不阻断整集
            results.append({"id": case["id"], "error": f"{type(exc).__name__}: {exc}"})
    return results


def summarize(results: list[dict]) -> dict:
    scored = [r for r in results if r.get("judge_score")]
    rule_passed = sum(1 for r in results if r.get("rule_pass"))
    errored = sum(1 for r in results if r.get("error"))
    avg = (
        round(sum(r["judge_score"] for r in scored) / len(scored), 2)
        if scored
        else None
    )
    return {
        "total": len(results),
        "rule_passed": rule_passed,
        "judge_avg": avg,
        "errored": errored,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="数字员工行为评估集 runner")
    ap.add_argument("--case", help="只跑指定 id")
    ap.add_argument("--list", action="store_true", help="只列用例")
    ap.add_argument("--out", help="结果 JSON 写入路径")
    args = ap.parse_args()

    cases = load_cases()
    if args.case:
        cases = [c for c in cases if c["id"] == args.case]
        if not cases:
            raise SystemExit(f"未找到用例: {args.case}")

    if args.list:
        for c in cases:
            print(f"  {c['id']:32s} [{c.get('category','')}] target={c.get('target')}")
        print(f"\n共 {len(cases)} 例")
        return

    results = asyncio.run(run_all(cases))
    summary = summarize(results)
    report = {"summary": summary, "results": results}

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    for r in results:
        if r.get("error"):
            print(f"  ✗ {r['id']}: {r['error']}")
        else:
            mark = "✓" if r.get("rule_pass") else "✗"
            print(f"  {mark} {r['id']:32s} rule={r.get('rule_pass')} judge={r.get('judge_score')}")

    if args.out:
        Path(args.out).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n报告已写入 {args.out}")


if __name__ == "__main__":
    main()
