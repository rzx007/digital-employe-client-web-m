from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator

from src.core.cst import CST


class CstDateTime(TypeDecorator):
    """SQLite 不存时区。本类型把 datetime 列归一到 CST 本地墙上时间存储，
    读出时统一补回 CST tzinfo，使 ORM 层 datetime 恒为 CST-aware。"""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(CST)
        return value.replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=CST) if value.tzinfo is None else value.astimezone(CST)
