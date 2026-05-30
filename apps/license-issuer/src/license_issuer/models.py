"""结构化结果（CLI 与未来 GUI 共用）。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class KeypairPaths:
    private_key: Path
    public_key: Path


@dataclass(frozen=True)
class IssueResult:
    device_code_display: str
    expires_at: datetime
    license_code: str
