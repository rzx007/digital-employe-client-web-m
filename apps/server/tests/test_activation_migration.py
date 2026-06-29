"""migrate_legacy_activation 升级迁移单测。

旧数据目录(.boban-staff/.digital-employee) → 新目录(.boban-staff-next) 的
activation.json 拷贝：非破坏、幂等、按优先级取最新旧目录。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.core.activation import storage

_RECORD = {
    "device_code": "ABCD",
    "license_code": "L",
    "expires_at": "2099-01-01T00:00:00+00:00",
    "activated_at": "2020-01-01T00:00:00+00:00",
    "last_seen_at": None,
}


@pytest.fixture()
def home(tmp_path, monkeypatch):
    """把 Path.home() 钉到 tmp_path，使新/旧目录都落在隔离目录下。"""
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return tmp_path


def _write_legacy(home: Path, dirname: str, record: dict) -> Path:
    p = home / dirname / "data" / storage._FILENAME
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(record), encoding="utf-8")
    return p


def test_migrates_from_boban_staff(home):
    legacy = _write_legacy(home, ".boban-staff", _RECORD)

    assert storage.migrate_legacy_activation() is True

    dest = storage._activation_path()
    assert dest == home / ".boban-staff-next" / "data" / storage._FILENAME
    assert dest.exists()
    assert json.loads(dest.read_text(encoding="utf-8")) == _RECORD
    # 非破坏：旧文件保留
    assert legacy.exists()


def test_noop_when_new_already_exists(home):
    _write_legacy(home, ".boban-staff", _RECORD)
    dest = storage._activation_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text('{"keep": 1}', encoding="utf-8")

    assert storage.migrate_legacy_activation() is False
    # 不覆盖既有新文件
    assert json.loads(dest.read_text(encoding="utf-8")) == {"keep": 1}


def test_noop_when_no_legacy(home):
    assert storage.migrate_legacy_activation() is False
    assert not storage._activation_path().exists()


def test_prefers_boban_staff_over_digital_employee(home):
    _write_legacy(home, ".digital-employee", {**_RECORD, "license_code": "OLD"})
    _write_legacy(home, ".boban-staff", {**_RECORD, "license_code": "NEW"})

    assert storage.migrate_legacy_activation() is True

    migrated = json.loads(storage._activation_path().read_text(encoding="utf-8"))
    assert migrated["license_code"] == "NEW"


def test_falls_back_to_digital_employee(home):
    _write_legacy(home, ".digital-employee", {**_RECORD, "license_code": "OLD"})

    assert storage.migrate_legacy_activation() is True

    migrated = json.loads(storage._activation_path().read_text(encoding="utf-8"))
    assert migrated["license_code"] == "OLD"
