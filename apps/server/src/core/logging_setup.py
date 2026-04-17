from __future__ import annotations

import logging
import sys
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

# 与 src 平级：<apps/server>/logs/
_LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
_APP_LOG = _LOG_DIR / "app.log"
_ERROR_LOG = _LOG_DIR / "error.log"
# 按日切分，保留约7天的备份（可按需调小）
_BACKUP_COUNT = 7


def _console_attached(root: logging.Logger) -> bool:
    """控制台 Handler 需与文件 Handler 区分（FileHandler 也是 StreamHandler 子类）。"""
    for handler in root.handlers:
        if isinstance(handler, logging.StreamHandler):
            stream = getattr(handler, "stream", None)
            if stream in (sys.stdout, sys.stderr):
                return True
    return False


def _timed_log_attached(root: logging.Logger, log_path: Path) -> bool:
    resolved = log_path.resolve()
    for handler in root.handlers:
        if isinstance(handler, TimedRotatingFileHandler):
            try:
                if Path(handler.baseFilename).resolve() == resolved:
                    return True
            except (AttributeError, OSError, ValueError):
                continue
    return False


def setup_logging() -> Path:
    """将应用日志按日写入 logs/app.log，ERROR 及以上单独按日写入 logs/error.log，并输出到控制台。"""
    _LOG_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    if not _timed_log_attached(root, _APP_LOG):
        app_handler = TimedRotatingFileHandler(
            str(_APP_LOG),
            when="midnight",
            interval=1,
            backupCount=_BACKUP_COUNT,
            encoding="utf-8",
        )
        app_handler.setLevel(logging.INFO)
        app_handler.setFormatter(formatter)
        root.addHandler(app_handler)

    if not _timed_log_attached(root, _ERROR_LOG):
        err_handler = TimedRotatingFileHandler(
            str(_ERROR_LOG),
            when="midnight",
            interval=1,
            backupCount=_BACKUP_COUNT,
            encoding="utf-8",
        )
        err_handler.setLevel(logging.ERROR)
        err_handler.setFormatter(formatter)
        root.addHandler(err_handler)

    if not _console_attached(root):
        console = logging.StreamHandler(sys.stdout)
        console.setLevel(logging.INFO)
        console.setFormatter(formatter)
        root.addHandler(console)

    return _APP_LOG
