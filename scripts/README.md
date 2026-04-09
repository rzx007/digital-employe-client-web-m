# 构建脚本

本目录包含项目构建相关的脚本。

## Python 后端打包脚本 (`build-server.py`)

### 功能

- 使用 PyInstaller 将 FastAPI 后端打包为 standalone executable
- 自动处理依赖安装
- 支持跨平台打包 (Windows/macOS/Linux)
- 清理构建产物

### 使用方法

#### 1. 安装依赖

确保已安装:

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) - Python 包管理器
- PyInstaller: `pip install pyinstaller`

#### 2. 构建命令

```bash
# 使用 npm 脚本（推荐）
pnpm build:server           # 正常构建
pnpm build:server:clean    # 清理后构建
pnpm build:server:debug    # 调试模式构建

# 直接使用 Python 脚本
python scripts/build-server.py [--clean] [--debug]

# 打包 Python 后端 + Electron 应用
python scripts/build-server.py --app
```

#### 3. 参数说明

- `--clean`: 清理之前的构建产物
- `--debug`: 启用调试模式，不删除临时文件

### 输出文件

构建完成后，可执行文件将输出到:

```bash
apps/web/py-server/backend.exe  # Windows
apps/web/py-server/backend      # macOS/Linux
```

同时会复制以下文件到输出目录:

- `.env` - 环境变量
- `README.md` - 项目说明

### 构建流程

1. **检查前置条件** - 验证目录和文件是否存在
2. **安装依赖** - 使用 uv 安装 Python 依赖
3. **PyInstaller 打包** - 打包为单文件可执行程序
4. **复制额外文件** - 复制配置和说明文件
5. **清理临时文件** - 删除构建中间文件（除非调试模式）

### 平台支持

- **Windows**: 生成 `backend.exe`，显示控制台窗口
- **macOS**: 生成 `backend`，无控制台窗口
- **Linux**: 生成 `backend`，显示控制台窗口

### 注意事项

1. 首次构建可能需要较长时间下载依赖
2. 确保有足够的磁盘空间（构建产物约 50-100MB）
3. 生产环境建议使用 `--clean` 参数确保干净的构建
4. 调试时使用 `--debug` 参数保留临时文件以便排查问题

### 集成到 Electron

打包后的可执行文件会被 Electron 的 `extraResources` 配置包含到应用资源中:

- 开发模式: 从 `apps/web/py-server/` 读取
- 生产模式: 从 `process.resourcesPath/py-server/` 读取
