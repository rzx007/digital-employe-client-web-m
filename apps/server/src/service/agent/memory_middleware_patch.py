"""Patch deepagents MemoryMiddleware to decode AGENTS.md with GBK fallback."""

from __future__ import annotations

import logging

from src.service.agent.memory_file import decode_memory_bytes

logger = logging.getLogger(__name__)
_patched = False


def install_safe_memory_decode() -> None:
    global _patched
    if _patched:
        return

    from deepagents.middleware import memory as memory_mod

    def _load_memory_contents(self, state, runtime, config):
        if "memory_contents" in state:
            return None

        backend = self._get_backend(state, runtime, config)
        contents: dict[str, str] = {}
        results = backend.download_files(list(self.sources))
        for path, response in zip(self.sources, results, strict=True):
            if response.error is not None:
                if response.error == "file_not_found":
                    continue
                msg = f"Failed to download {path}: {response.error}"
                raise ValueError(msg)
            if response.content is not None:
                contents[path] = decode_memory_bytes(response.content)
                logger.debug("Loaded memory from: %s", path)

        return memory_mod.MemoryStateUpdate(memory_contents=contents)

    async def _aload_memory_contents(self, state, runtime, config):
        if "memory_contents" in state:
            return None

        backend = self._get_backend(state, runtime, config)
        contents: dict[str, str] = {}
        results = await backend.adownload_files(list(self.sources))
        for path, response in zip(self.sources, results, strict=True):
            if response.error is not None:
                if response.error == "file_not_found":
                    continue
                msg = f"Failed to download {path}: {response.error}"
                raise ValueError(msg)
            if response.content is not None:
                contents[path] = decode_memory_bytes(response.content)
                logger.debug("Loaded memory from: %s", path)

        return memory_mod.MemoryStateUpdate(memory_contents=contents)

    memory_mod.MemoryMiddleware.before_agent = _load_memory_contents
    memory_mod.MemoryMiddleware.abefore_agent = _aload_memory_contents
    _patched = True
    logger.info("Installed safe memory decode patch for MemoryMiddleware")
