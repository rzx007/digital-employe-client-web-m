# ARM64 DEB 打包说明

在 macOS（Apple Silicon）上将数字员工客户端打包为 Ubuntu 24.04 ARM64 的 `.deb` 安装包。

## 前置条件

- macOS Apple Silicon 机器
- Docker Desktop（已安装并运行）

## 快速开始

```bash
bash scripts/build-deb.sh
```

输出文件在 `release/DigitalEmployee-Linux-arm64-{version}.deb`。

## 构建流程

1. Docker 构建 ARM64 Ubuntu 24.04 环境镜像（含 Node.js 24、pnpm、uv、Electron 运行时库）
2. 源码以只读方式挂载至容器，rsync 排除 `node_modules`/`.git`
3. 容器内依次执行：
   - `pnpm install` — 安装前端依赖
   - `pnpm build:app` — 自动完成：
     1. `python3 scripts/build-server.py --app`（内部自动 `uv sync` 安装 Python 依赖 + PyInstaller 打包后端）
     2. `pnpm build:client` → Vite 构建前端 + electron-builder 打包为 `.deb`
4. `.deb` 输出到宿主机 `release/` 目录

> 宿主机 `node_modules` 不受影响。

## 在目标机器安装

```bash
sudo dpkg -i DigitalEmployee-Linux-arm64-{version}.deb
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `Dockerfile` | ARM64 构建环境定义 |
| `scripts/build-deb.sh` | 一键构建脚本 |
| `.dockerignore` | Docker 构建上下文排除 |
