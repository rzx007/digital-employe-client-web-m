# ARM64 DEB 打包说明

在 **Apple Silicon（arm64）macOS** 上，通过 Docker 将数字员工客户端交叉打包为 Ubuntu 24.04 ARM64 的 `.deb` 安装包。

> **运行环境**：`bash scripts/build-deb.sh` 及 `pnpm build:deb:arm64*` 均须在 **arm64 macOS** 上执行（需 Docker Desktop）。Windows / Linux 宿主机不支持直接运行该脚本；在 Windows 上请用 `pnpm build:app` / `pnpm build:app:offline` 打本地安装包。

## 前置条件

- **Apple Silicon Mac**（`uname -m` 为 `arm64`）
- Docker Desktop（已安装并运行）

## 快速开始

在 **arm64 macOS** 终端中执行：

```bash
# 在线版
bash scripts/build-deb.sh

# 离线版（安装包内嵌 .offline，产物名带 Offline）
bash scripts/build-deb.sh --offline

# 离线版 + 额外清理 build/server（PyInstaller 异常后可试）
bash scripts/build-deb.sh --offline --clean
```

或通过根目录脚本：

```bash
pnpm build:deb:arm64
pnpm build:deb:arm64:offline
pnpm build:deb:arm64:offline:clean
```

### 产物

| 命令 | 输出文件 |
|------|----------|
| 在线 | `release/DigitalEmployee-Linux-arm64-{version}.deb` |
| 离线 | `release/DigitalEmployee-Offline-Linux-arm64-{version}.deb` |

## 构建流程

1. Docker 构建 ARM64 Ubuntu 24.04 环境镜像（含 Node.js 24、pnpm、uv、Electron 运行时库）
2. 源码以只读方式挂载至容器，rsync 排除 `node_modules`/`.git`
3. 容器内依次执行：
   - `pnpm install` — 安装前端依赖
   - **在线**：`pnpm build:app` — `build-server.py` 打后端 + electron-builder 打 deb
   - **离线**：`pnpm build:app:offline` — 打后端 → 写 `py-server/.offline` → `electron-builder.offline.json5` 打 deb
4. `.deb` 输出到宿主机 `release/` 目录

> 宿主机 `node_modules` 不受影响。`build-server.py` 每次会先清空 `py-server`，避免在线/离线构建互相污染。

## 在目标机器安装

```bash
# 在线
sudo dpkg -i DigitalEmployee-Linux-arm64-{version}.deb

# 离线
sudo dpkg -i DigitalEmployee-Offline-Linux-arm64-{version}.deb
```

安装后验证离线模式（离线包）：

```bash
curl http://127.0.0.1:34567/system/runtime
# 期望 offline_mode: true
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `Dockerfile` | ARM64 构建环境定义 |
| `scripts/build-deb.sh` | 一键构建脚本（支持 `--offline` / `--clean`） |
| `.dockerignore` | Docker 构建上下文排除 |
