# 飞书签发服务镜像。私钥严禁打进镜像层，运行时通过挂载卷 / 环境变量注入。
FROM python:3.11-slim

WORKDIR /app

# 安装 uv
RUN pip install --no-cache-dir uv

# 拷贝 workspace 中签发相关的三个包（activation-core / license-issuer / 本服务）
COPY packages/activation-core /app/packages/activation-core
COPY apps/license-issuer /app/apps/license-issuer
COPY apps/license-issuer-server /app/apps/license-issuer-server

WORKDIR /app/apps/license-issuer-server
RUN uv pip install --system --no-cache .

# 运行时注入：
#   ISSUER_API_TOKEN          调用方 Bearer token（必填）
#   DE_LICENSE_PRIVATE_KEY    私钥路径（指向挂载进来的私钥，必填）
#   ISSUER_DEFAULT_EXPIRES    默认到期（默认 +90d）
#   ISSUER_PORT               监听端口（默认 8900）
EXPOSE 8900
CMD ["python", "-m", "license_issuer_server"]
