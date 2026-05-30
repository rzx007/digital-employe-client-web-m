"""validate_path shim：放行本机绝对路径，虚拟路径仍走原逻辑。"""

import pytest

from src.service.agent.path_access import config as pa_config
from src.service.agent.path_access import get_path_access_config
from src.service.agent.path_access import validate_path_shim as shim


def test_host_paths_bypass_orig(monkeypatch):
    def fake_orig(path, *, allowed_prefixes=None):
        raise AssertionError("orig validate_path should not run for host path")

    monkeypatch.setattr(shim, "_orig_validate_path", fake_orig)
    assert shim._validate_path_allow_physical("C:\\Users\\me\\a.pdf") == "C:/Users/me/a.pdf"
    assert shim._validate_path_allow_physical("/Users/me/a.pdf") == "/Users/me/a.pdf"


def test_virtual_paths_delegate_to_orig(monkeypatch):
    seen = {}

    def fake_orig(path, *, allowed_prefixes=None):
        seen["path"] = path
        seen["prefixes"] = allowed_prefixes
        return "ORIG:" + path

    monkeypatch.setattr(shim, "_orig_validate_path", fake_orig)
    out = shim._validate_path_allow_physical(
        "/artifacts/report.md", allowed_prefixes=["/artifacts/"]
    )
    assert out == "ORIG:/artifacts/report.md"
    assert seen["path"] == "/artifacts/report.md"
    assert seen["prefixes"] == ["/artifacts/"]


def test_config_gating(monkeypatch):
    monkeypatch.setenv("AGENT_VIRTUAL_MODE", "0")
    cfg = get_path_access_config()
    assert cfg.shell_physical is True
    assert cfg.enable_validate_path_shim is True

    monkeypatch.setenv("AGENT_VIRTUAL_MODE", "1")
    cfg = get_path_access_config()
    assert cfg.shell_physical is False
    assert cfg.enable_validate_path_shim is False
    assert pa_config.is_virtual_mode_enabled() is True
