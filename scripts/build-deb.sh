#!/bin/bash
# ARM64 Linux deb 交叉打包脚本
#
# 运行环境：须在 Apple Silicon（arm64）macOS 上执行，依赖 Docker Desktop。
# 不支持在 Windows / Linux 宿主机上直接运行本脚本。
set -euo pipefail

# GitLab CI 的 group 变量会注入 DOCKER_HOST=tcp://192.168.2.103:2375 等，
# 导致 docker 连远端 daemon（非本机 Docker Desktop），在 Mac 上打 arm64 会报
# "exec /bin/sh: transport endpoint is not connected"。强制走本机 Docker。
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_CONTEXT

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
IMAGE_NAME="digital-employee-builder:arm64"

OFFLINE=0
CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    --clean) CLEAN=1 ;;
    -h | --help)
      echo "用法: bash scripts/build-deb.sh [--offline] [--clean]"
      echo ""
      echo "运行环境: Apple Silicon（arm64）macOS + Docker Desktop"
      echo "  （在 Windows / Linux 宿主机上请勿直接运行本脚本）"
      echo ""
      echo "  --offline  打包离线版 deb（写入 .offline，产物名带 Offline）"
      echo "  --clean    额外清理 build/server 临时目录（传给 build-offline-app / build-server）"
      exit 0
      ;;
    *)
      echo "未知参数: $arg（可用 --offline、--clean、--help）"
      exit 1
      ;;
  esac
done

if [ "$OFFLINE" -eq 1 ]; then
  if [ "$CLEAN" -eq 1 ]; then
    BUILD_CMD="pnpm build:app:offline:clean"
  else
    BUILD_CMD="pnpm build:app:offline"
  fi
  TITLE="数字员工客户端 - ARM64 DEB 离线版打包"
  ARTIFACT_HINT="DigitalEmployee-Offline-Linux-arm64-{version}.deb"
else
  BUILD_CMD="pnpm build:app"
  TITLE="数字员工客户端 - ARM64 DEB 打包"
  ARTIFACT_HINT="DigitalEmployee-Linux-arm64-{version}.deb"
fi

echo "=========================================="
echo "$TITLE"
echo "  运行环境: Apple Silicon（arm64）macOS + Docker Desktop"
echo "=========================================="
echo ""

mkdir -p "$RELEASE_DIR"

echo "[1/4] 确保 fpm 缓存（macOS → Docker 挂载）..."
FPM_CACHE_DIR="$HOME/.cache/electron-builder"
FPM_FILE="fpm-1.17.0-ruby-3.4.3-linux-arm64v8.7z"
FPM_URL="https://github.com/electron-userland/electron-builder-binaries/releases/download/fpm@2.1.4/$FPM_FILE"
mkdir -p "$FPM_CACHE_DIR/fpm"
if [ ! -f "$FPM_CACHE_DIR/fpm/$FPM_FILE" ]; then
  echo "  在 macOS 端下载 fpm..."
  curl -fsSL "$FPM_URL" -o "$FPM_CACHE_DIR/fpm/$FPM_FILE"
  echo "  fpm 已缓存到 $FPM_CACHE_DIR/fpm/$FPM_FILE"
else
  echo "  fpm 缓存已存在: $FPM_CACHE_DIR/fpm/$FPM_FILE"
fi

echo "[2/4] 构建 Docker 构建镜像..."
# Apple Silicon 原生 linux/arm64 无需 buildx；buildx 在 Docker Desktop 上偶发
# 「exec /bin/sh: transport endpoint is not connected」（VM/virtiofs 挂载断开）。
if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
  docker build --platform linux/arm64 -t "$IMAGE_NAME" "$ROOT_DIR"
else
  docker buildx build \
    --platform linux/arm64 \
    -t "$IMAGE_NAME" \
    --load \
    "$ROOT_DIR"
fi

echo ""
echo "[3/4] 在容器内构建应用..."
echo "  构建命令: $BUILD_CMD"
echo "  （项目源码以只读方式挂载，不会影响 macOS 上的 node_modules）"
docker run --rm \
  --platform linux/arm64 \
  --memory=8g \
  -v "$ROOT_DIR:/host-source:ro" \
  -v "$RELEASE_DIR:/output" \
  -v "$FPM_CACHE_DIR:/fpm-seed:ro" \
  -v "digital-employee-uv-cache:/root/.cache/uv" \
  -v "digital-employee-pnpm-store:/root/.local/share/pnpm/store" \
  -e ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
  -e ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/" \
  -e ELECTRON_BUILDER_CACHE="/root/.cache/electron-builder" \
  -e BUILD_CMD="$BUILD_CMD" \
  -e NODE_OPTIONS="--max-old-space-size=8192" \
  "$IMAGE_NAME" \
  bash -c '
set -euo pipefail

echo "  复制项目源码到容器（排除 node_modules）..."
mkdir -p /build
rsync -a --delete \
  --exclude=node_modules \
  --exclude="*/node_modules" \
  --exclude=.pnpm-store \
  --exclude=.venv \
  --exclude=".venv/" \
  --exclude=.git \
  --exclude=release \
  /host-source/ /build/

cd /build

echo "  播种 fpm 缓存到容器本地层（virtiofs 挂载上 proper-lockfile 锁不可靠，会 stale）..."
mkdir -p /root/.cache/electron-builder
cp -a /fpm-seed/. /root/.cache/electron-builder/ 2>/dev/null || true

echo "  安装 pnpm 依赖..."
pnpm install --frozen-lockfile

echo ""
echo "  构建应用: ${BUILD_CMD}"
${BUILD_CMD}

echo ""
echo "  复制 deb 包到输出目录..."
mkdir -p /output
cp -v apps/web/release/*.deb /output/ 2>/dev/null || echo "  （未找到 deb 包，检查日志）"
echo ""
echo "✅ 构建完成！"
ls -lh /output/
'

echo ""
echo "=========================================="
echo "✅ 打包完成!"
echo "   输出目录: $RELEASE_DIR"
echo "   预期产物: $ARTIFACT_HINT"
echo "   fpm 缓存: $FPM_CACHE_DIR/fpm/$FPM_FILE"
ls -lh "$RELEASE_DIR"/*.deb 2>/dev/null || echo "   （未找到 deb 包，请检查构建日志）"
echo "=========================================="
