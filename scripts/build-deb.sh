#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
IMAGE_NAME="digital-employee-builder:arm64"

echo "=========================================="
echo "数字员工客户端 - ARM64 DEB 打包脚本"
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
echo "  （项目源码以只读方式挂载，不会影响 macOS 上的 node_modules）"
docker run --rm \
    --platform linux/arm64 \
    -v "$ROOT_DIR:/host-source:ro" \
    -v "$RELEASE_DIR:/output" \
    -e ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" \
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
echo "  构建应用（build-server.py 自动安装 Py 依赖 + PyInstaller 打包后端 + electron-builder 打包 deb）..."
pnpm build:app

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
ls -lh "$RELEASE_DIR"/*.deb 2>/dev/null || echo "   （未找到 deb 包，请检查构建日志）"
echo "=========================================="
