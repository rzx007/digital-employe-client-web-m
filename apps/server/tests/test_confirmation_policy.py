from __future__ import annotations

from src.service.agent.orchestrator.confirmation_policy import (
    compute_requires_confirmation,
)


def _readonly_task(**over):
    """单个只读/查询类任务的基线 dict（small 档、无 cron、无破坏性词）。"""
    base = {
        "task_name": "查询微博热搜",
        "prompt": "查询今日微博热搜 TOP20 并整理成榜单返回",
        "output_tier": "small",
        "cron": None,
        "depends_on": None,
    }
    base.update(over)
    return base


# ── 仍需确认的场景 ──────────────────────────────────────────────────────────

def test_requires_confirmation_when_scheduled():
    assert compute_requires_confirmation([
        _readonly_task(cron="30 9 * * *"),
    ]) is True


def test_requires_confirmation_when_more_than_one_task():
    assert compute_requires_confirmation([
        _readonly_task(),
        _readonly_task(task_name="B"),
    ]) is True


def test_requires_confirmation_when_has_dependency():
    assert compute_requires_confirmation([
        _readonly_task(),
        _readonly_task(task_name="B", depends_on=0),
    ]) is True


def test_requires_confirmation_when_not_small_tier():
    """非 small 档（standard/large）= 不是轻量查询，仍需确认。"""
    assert compute_requires_confirmation([
        _readonly_task(output_tier="standard"),
    ]) is True
    assert compute_requires_confirmation([
        _readonly_task(output_tier="large"),
    ]) is True


def test_requires_confirmation_when_tier_missing():
    """缺省 output_tier（视作非 small）→ 保守要确认。"""
    t = _readonly_task()
    t.pop("output_tier")
    assert compute_requires_confirmation([t]) is True


def test_requires_confirmation_when_destructive_keyword_in_prompt():
    assert compute_requires_confirmation([
        _readonly_task(prompt="删除产物目录下的旧报告并清空缓存"),
    ]) is True


def test_requires_confirmation_when_destructive_keyword_in_task_name():
    assert compute_requires_confirmation([
        _readonly_task(task_name="发布公众号文章"),
    ]) is True


def test_requires_confirmation_when_shell_destructive_command():
    assert compute_requires_confirmation([
        _readonly_task(prompt="跑 rm -rf 旧目录后重新拉取数据"),
    ]) is True


# ── 免确认场景：单个只读/查询类任务 ─────────────────────────────────────────

def test_no_confirmation_for_single_readonly_query_task():
    assert compute_requires_confirmation([_readonly_task()]) is False
