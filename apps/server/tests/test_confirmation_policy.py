from __future__ import annotations

from src.service.agent.orchestrator.confirmation_policy import (
    compute_requires_confirmation,
)


def test_requires_confirmation_when_scheduled():
    assert compute_requires_confirmation([
        {"task_name": "A", "cron": "30 9 * * *"},
    ]) is True


def test_requires_confirmation_when_more_than_two_tasks():
    assert compute_requires_confirmation([
        {"task_name": "A"},
        {"task_name": "B"},
        {"task_name": "C"},
    ]) is True


def test_requires_confirmation_when_has_dependency():
    assert compute_requires_confirmation([
        {"task_name": "A"},
        {"task_name": "B", "depends_on": 1},
    ]) is True


def test_no_confirmation_for_simple_immediate_tasks():
    assert compute_requires_confirmation([
        {"task_name": "A"},
        {"task_name": "B"},
    ]) is True

    assert compute_requires_confirmation([
        {"task_name": "A", "cron": None, "depends_on": None},
    ]) is True
