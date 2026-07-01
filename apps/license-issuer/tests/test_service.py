"""IssueService / KeyService 单测。"""

from __future__ import annotations

from pathlib import Path

import pytest

from license_issuer.service import IssueService, KeyService


def test_generate_and_issue(tmp_path: Path):
    paths = KeyService.generate_keypair(tmp_path)
    result = IssueService().issue("ABCD-EFGH", "+30d", paths.private_key)
    assert result.license_code
    assert "ABCD" in result.device_code_display
    IssueService().verify(result.license_code, "ABCD-EFGH", paths.public_key)


def test_issue_rejects_missing_private_key(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        IssueService().issue("ABCD", "+7d", tmp_path / "missing.pem")
