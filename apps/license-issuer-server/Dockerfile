# 飞书签发服务镜像。私钥严禁打进镜像层，运行时通过挂载卷 / 环境变量注入。
FROM python:3.11-slim

WORKDIR /app

# 安装 uv（pip 走清华源加速）
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple uv

# 拷贝签发相关的三个本地包（activation-core / license-issuer / 本服务）
COPY packages/activation-core /app/packages/activation-core
COPY apps/license-issuer /app/apps/license-issuer
COPY apps/license-issuer-server /app/apps/license-issuer-server

# 这些本地包的 pyproject 里 [tool.uv.sources] 用了 workspace=true（为 monorepo 开发设计）。
# 镜像里无 workspace 根，会导致 uv 解析失败——build 时剥掉这些 source 重定向行，
# 改为按目录直接安装本地包（不影响其声明的第三方依赖）。
WORKDIR /app
ENV UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN sed -i '/\[tool\.uv\.sources\]/,/^$/d' \
      apps/license-issuer/pyproject.toml \
      apps/license-issuer-server/pyproject.toml \
 && uv pip install --system --no-cache --no-deps \
      ./packages/activation-core \
      ./apps/license-issuer \
      ./apps/license-issuer-server \
 && uv pip install --system --no-cache \
      "fastapi>=0.104.0" "uvicorn>=0.24.0" "cryptography" "typer" "rich"

WORKDIR /app/apps/license-issuer-server

# 运行时注入：
#   ISSUER_API_TOKEN          调用方 Bearer token（必填）
#   DE_LICENSE_PRIVATE_KEY    私钥路径（指向挂载进来的私钥，必填）
#   ISSUER_DEFAULT_EXPIRES    默认到期（默认 +90d）
#   ISSUER_PORT               监听端口（默认 8900）
EXPOSE 8900
CMD ["python", "-m", "license_issuer_server"]
