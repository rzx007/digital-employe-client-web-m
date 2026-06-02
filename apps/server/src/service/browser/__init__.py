"""Browser automation runtime (Electron CDP bridge on 127.0.0.1:34555)."""

from src.service.browser.browser_runtime_client import (
    BrowserRuntimeClient,
    CdpResult,
)

__all__ = ["BrowserRuntimeClient", "CdpResult"]
