#!/bin/bash
# ARM64 Linux deb 交叉打包脚本
#
# 运行环境：须在 Apple Silicon（arm64）macOS 上执行，依赖 Docker Desktop。
# 不支持在 Windows / Linux 宿主机上直接运行本脚本。
set -euo pipefail

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

echo "[1/3] 构建 Docker 构建镜像..."
docker buildx build \
  --platform linux/arm64 \
  -t "$IMAGE_NAME" \
  --load \
  "$ROOT_DIR"

echo ""
echo "[2/3] 在容器内构建应用..."
echo "  构建命令: $BUILD_CMD"
echo "  （项目源码以只读方式挂载，不会影响 macOS 上的 node_modules）"
docker run --rm \
  --platform linux/arm64 \
  -v "$ROOT_DIR:/host-source:ro" \
  -v "$RELEASE_DIR:/output" \
  -e ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" \
  -e BUILD_CMD="$BUILD_CMD" \
  "$IMAGE_NAME" \
  bash -c '
set -euo pipefail

echo "  复制项目源码到容器（排除 node_modules）..."
mkdir -p /build
rsync -a --delete \
  --exclude=node_modules \
  --exclude="*/node_modules" \
  --exclude=.pnpm-store \
  --exclude=.git \
  --exclude=release \
  /host-source/ /build/

cd /build

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
ls -lh "$RELEASE_DIR"/*.deb 2>/dev/null || echo "   （未找到 deb 包，请检查构建日志）"
echo "=========================================="
