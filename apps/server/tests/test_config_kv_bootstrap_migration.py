"""测试 ConfigKvService 的旧值定向迁移。

迁移哨兵在 bootstrap_from_json 末尾跑：值精确等于 LEGACY_KV_MIGRATIONS 旧值的行才更新，
其它情况（未配置 / 用户自定义 / 空串）保持原样。
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from src.models.config_kv import ConfigKv
from src.service.config_kv_service import LEGACY_KV_MIGRATIONS, ConfigKvService


def _write_seed(tmp_path: Path, payload: dict) -> Path:
    p = tmp_path / "config-kv.init.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_migration_replaces_known_stale_value(
    db_session: Session, tmp_path: Path
) -> None:
    key, stale, new = LEGACY_KV_MIGRATIONS[0]
    db_session.add(ConfigKv(config_key=key, config_value=stale))
    db_session.commit()

    ConfigKvService.bootstrap_from_json(db_session, _write_seed(tmp_path, {}))

    row = db_session.query(ConfigKv).filter_by(config_key=key).one()
    assert row.config_value == new


def test_migration_keeps_user_customized_value(
    db_session: Session, tmp_path: Path
) -> None:
    """用户在系统设置页改成自家飞书 app 后，迁移不应覆盖。"""
    key, _stale, _new = LEGACY_KV_MIGRATIONS[0]
    user_value = "cli_user_custom_app_xxxxxx"
    db_session.add(ConfigKv(config_key=key, config_value=user_value))
    db_session.commit()

    ConfigKvService.bootstrap_from_json(db_session, _write_seed(tmp_path, {}))

    row = db_session.query(ConfigKv).filter_by(config_key=key).one()
    assert row.config_value == user_value


def test_migration_skips_missing_key(db_session: Session, tmp_path: Path) -> None:
    """KV 表里完全没有这条记录时，迁移不创建新行（由 seed 路径负责插入）。"""
    key, _stale, _new = LEGACY_KV_MIGRATIONS[0]

    ConfigKvService.bootstrap_from_json(db_session, _write_seed(tmp_path, {}))

    assert db_session.query(ConfigKv).filter_by(config_key=key).first() is None


def test_migration_is_idempotent(db_session: Session, tmp_path: Path) -> None:
    """两次 bootstrap 不会重复变更已迁移的值。"""
    key, stale, new = LEGACY_KV_MIGRATIONS[0]
    db_session.add(ConfigKv(config_key=key, config_value=stale))
    db_session.commit()

    ConfigKvService.bootstrap_from_json(db_session, _write_seed(tmp_path, {}))
    ConfigKvService.bootstrap_from_json(db_session, _write_seed(tmp_path, {}))

    row = db_session.query(ConfigKv).filter_by(config_key=key).one()
    assert row.config_value == new


def test_register_feishu_swaps_credentials_without_restart() -> None:
    """同名 register 必须替换 authlib 缓存的 client，否则 KV 改了不重启不生效。"""
    from src.service.oauth import feishu as feishu_mod

    feishu_mod._last_registered = None
    feishu_mod.oauth._clients.pop("feishu", None)
    feishu_mod.oauth._registry.pop("feishu", None)

    feishu_mod.register_feishu("cli_old", "secret_old", "http://a/cb")
    client_old = feishu_mod.get_feishu_client()
    assert client_old.client_id == "cli_old"

    feishu_mod.register_feishu("cli_new", "secret_new", "http://a/cb")
    client_new = feishu_mod.get_feishu_client()
    assert client_new.client_id == "cli_new"
    assert client_new is not client_old
