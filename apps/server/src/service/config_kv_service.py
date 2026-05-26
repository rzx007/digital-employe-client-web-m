from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings, join_base_and_path
from src.models.config_kv import ConfigKv

logger = logging.getLogger(__name__)


class ConfigKvService:
    @staticmethod
    def _refresh_settings_cache() -> None:
        get_settings.cache_clear()
        try:
            from src.db.session import reset_session_state

            reset_session_state()
        except Exception as exc:  # pylint: disable=broad-exception-caught
            logger.warning("Reset db session cache failed: %s", exc)

    @staticmethod
    def _normalize_key(config_key: str) -> str:
        key = config_key.strip()
        if not key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="config_key 不能为空。",
            )
        return key

    @staticmethod
    def create(db: Session, config_key: str, config_value: str) -> ConfigKv:
        key = ConfigKvService._normalize_key(config_key)
        existing = db.scalar(
            select(ConfigKv.id).where(ConfigKv.config_key == key)
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"配置键已存在: {key}",
            )
        row = ConfigKv(config_key=key, config_value=config_value)
        db.add(row)
        db.commit()
        db.refresh(row)
        ConfigKvService._refresh_settings_cache()
        return row

    @staticmethod
    def list_all(db: Session) -> list[ConfigKv]:
        return list(
            db.scalars(select(ConfigKv).order_by(ConfigKv.config_key.asc())).all()
        )

    @staticmethod
    def get_by_key(db: Session, config_key: str) -> ConfigKv:
        key = ConfigKvService._normalize_key(config_key)
        row = db.scalar(select(ConfigKv).where(ConfigKv.config_key == key))
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"未找到配置键: {key}",
            )
        return row

    @staticmethod
    def update_by_key(db: Session, config_key: str, config_value: str) -> ConfigKv:
        row = ConfigKvService.get_by_key(db, config_key)
        row.config_value = config_value
        db.commit()
        db.refresh(row)
        ConfigKvService._refresh_settings_cache()
        return row

    @staticmethod
    def delete_by_key(db: Session, config_key: str) -> None:
        row = ConfigKvService.get_by_key(db, config_key)
        db.delete(row)
        db.commit()
        ConfigKvService._refresh_settings_cache()

    @staticmethod
    def upsert(db: Session, config_key: str, config_value: str) -> ConfigKv:
        key = ConfigKvService._normalize_key(config_key)
        row = db.scalar(select(ConfigKv).where(ConfigKv.config_key == key))
        if row is not None:
            row.config_value = config_value
            db.commit()
            db.refresh(row)
        else:
            row = ConfigKv(config_key=key, config_value=config_value)
            db.add(row)
            db.commit()
            db.refresh(row)
        ConfigKvService._refresh_settings_cache()
        return row

    @staticmethod
    def bootstrap_from_json(
        db: Session, json_path: str | Path = "config-kv.init.json"
    ) -> int:
        path = Path(json_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        if not path.exists():
            logger.info("Config KV seed file not found: %s", path)
            return 0

        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("Config KV bootstrap file invalid JSON: %s", path)
            return 0

        if not isinstance(loaded, dict):
            logger.warning("Config KV seed JSON must be an object: %s", path)
            return 0

        inserted = 0
        for raw_key, raw_value in loaded.items():
            key = str(raw_key or "").strip()
            if not key:
                continue
            exists = db.scalar(
                select(ConfigKv.id).where(ConfigKv.config_key == key)
            )
            if exists is not None:
                continue
            value = "" if raw_value is None else str(raw_value)
            db.add(ConfigKv(config_key=key, config_value=value))
            inserted += 1
        if inserted > 0:
            db.commit()
            ConfigKvService._refresh_settings_cache()
        logger.info(
            "Config KV seed applied (insert-only, never overwrite): inserted=%s file=%s",
            inserted,
            path,
        )
        return inserted

    @staticmethod
    def sync_model_provider_from_remote(db: Session, token: str | None = None) -> bool:
        """从远程拉取模型服务商配置并覆盖本地关键配置。
        
        该函数从远程API获取模型服务商的配置信息（包括模型名称、API密钥和API地址），
        并将其同步到本地的LLM注册表中，设置为激活状态。
        
        Args:
            db: 数据库会话对象，用于更新本地模型注册表
            token: 可选的认证令牌，用于访问远程API
            
        Returns:
            bool: 同步是否成功
                - True: 成功从远程获取配置并更新到本地注册表
                - False: 同步失败（URL未配置、网络错误、响应格式错误、缺少必要字段等）
        """
        # 构建远程API URL
        settings = get_settings()
        url = join_base_and_path(
            settings.remote_api_base_url,
            settings.remote_model_provider_path,
        )
        if not url:
            logger.info(
                "Skip remote model provider sync: REMOTE_API_BASE_URL not configured"
            )
            return False

        # 发送HTTP请求获取远程配置
        try:
            headers = {"token": token or ""}
            response = httpx.get(
                url,
                headers=headers,
                timeout=settings.skill_remote_timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Failed to fetch remote model provider config: %s", exc)
            return False

        # 验证响应格式和业务状态码
        if not isinstance(payload, dict):
            logger.warning("Remote model provider response is not a JSON object")
            return False

        code = payload.get("code")
        if code not in (1, 200, "1", "200", None):
            logger.warning(
                "Remote model provider returned non-success code: code=%s msg=%s",
                code,
                payload.get("msg"),
            )
            return False

        # 提取并验证必要的配置字段
        data = payload.get("data")
        if not isinstance(data, dict):
            logger.warning("Remote model provider data is invalid: %r", data)
            return False

        model_name = str(data.get("modelName") or "").strip()
        api_key = str(data.get("apiKey") or "").strip()
        api_url = str(data.get("apiUrl") or "").strip()
        if not model_name or not api_key or not api_url:
            logger.warning(
                "Remote model provider missing required fields: modelName/apiKey/apiUrl"
            )
            return False

        # 将配置同步到本地LLM注册表
        from src.llm.registry_service import upsert_from_remote_sync

        upsert_from_remote_sync(
            db,
            model_name=model_name,
            api_key=api_key,
            api_url=api_url,
            set_as_active=True,
        )
        logger.info(
            "Synced model provider config from remote into registry: model=%s",
            model_name,
        )
        return True
