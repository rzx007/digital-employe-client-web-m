import logging
import os
import sys
import asyncio

# Windows: 必须在导入/启动 uvicorn 前强制 SelectorEventLoop。
# 根因（实测铁证）：uvicorn 在 Windows「非 reload」模式下直接用 asyncio.ProactorEventLoop
# 建循环（见 uvicorn/loops/asyncio.py asyncio_loop_factory），无视事件循环 policy。
# 而 Proactor 在大量连接重置(WinError 10054)/超长请求后会把 IOCP 套接字处理搞坏 →
# `_call_connection_lost` 满屏、整进程「再也连不上模型」（curl 同机却秒连，证明是 Proactor 坏了）。
# 配合下方 uvicorn.run(loop="none")：让 uvicorn 走 asyncio.Runner(默认) → 用本 policy → Selector。
# 本应用 shell 子进程走 subprocess.run+线程（非 asyncio 异步子进程），不依赖 Proactor，切换安全。
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from src.server import app

import uvicorn

from src.core.logging_setup import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

# 读取环境变量，默认开发环境（dev）,打包时注入 prod
ENV = os.getenv("ENVIRONMENT", "prod")  # dev / prod
IS_PROD = ENV == "prod"

if __name__ == "__main__":
    logger.info("当前环境: %s", ENV)
    logger.info("Starting server...")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("SERVER_PORT", 34567 )),
        reload=not IS_PROD,
        # loop="none"：禁用 uvicorn 自带的 loop_factory（Windows 非 reload 会强制 Proactor），
        # 改用 asyncio.Runner + 上面设的 SelectorEventLoop policy。
        loop="none",
    )
