import logging
import os
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
    )
