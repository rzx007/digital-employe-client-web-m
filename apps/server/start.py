import os
from src.server import app
import uvicorn

# 读取环境变量，默认开发环境（dev）,打包时注入prod
ENV = os.getenv("ENVIRONMENT", "prod")  # dev / prod
print(f"当前环境: {ENV}")
IS_PROD = ENV == "prod"

if __name__ == "__main__":
    print("Starting server...")
    uvicorn.run(
        "src.server:app",
        host="0.0.0.0",
        port=int(os.getenv("SERVER_PORT", 58000)),
        reload=not IS_PROD,
    )
