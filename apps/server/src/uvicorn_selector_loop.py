"""uvicorn `--loop` 自定义事件循环工厂。

根因（实测铁证）：uvicorn 在 Windows「非 reload」模式下默认用 asyncio.ProactorEventLoop
建循环（见 uvicorn/loops/asyncio.py asyncio_loop_factory），而 Proactor 在大量连接
重置(WinError 10054)/超长请求后会把 IOCP 套接字处理搞坏 → `_call_connection_lost`
满屏、整进程「再也连不上模型」（curl 同机却秒连，证明是 Proactor 坏了）。

用法：uvicorn 启动加 `--loop src.uvicorn_selector_loop:loop_factory`。

注意 uvicorn 对「自定义 loop 字符串」与「内置名(auto/asyncio/none)」处理不同：
- 内置名：Config.get_loop_factory() 会调 `factory(use_subprocess=...)` 再交给 Runner。
- 自定义字符串：`return import_from_string(self.loop)` —— 把本函数**原样**交给
  asyncio.Runner，Runner 以**零参** `loop_factory()` 调用，并期望返回一个**事件循环实例**。
因此本函数必须是「零参、返回 loop 实例」。

本应用 shell 子进程走 subprocess.run+线程（非 asyncio 异步子进程），不依赖 Proactor，
故 Windows 上切 SelectorEventLoop 安全。
"""

from __future__ import annotations

import asyncio
import sys


def loop_factory() -> asyncio.AbstractEventLoop:
    if sys.platform == "win32":
        # Windows: 强制 SelectorEventLoop 实例（取代默认的 ProactorEventLoop）
        return asyncio.SelectorEventLoop()
    # 非 Windows: 沿用 uvicorn 默认（auto → uvloop / asyncio），再实例化
    try:
        from uvicorn.loops.auto import auto_loop_factory

        return auto_loop_factory(use_subprocess=False)()
    except Exception:
        return asyncio.SelectorEventLoop()
