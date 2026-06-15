#!/usr/bin/env python3
"""
Python 后端打包脚本

使用 PyInstaller 将 FastAPI 后端打包为 standalone executable。
支持跨平台打包，自动处理依赖和资源文件。

使用方法:
    python scripts/build-server.py [--clean] [--debug] [--app]

参数:
    --clean: 额外清理 build/server 临时目录（py-server 每次打包前默认会清空）
    --debug: 启用调试模式，不删除临时文件
    --app: 打包 Python 后端后，再打包 Electron 应用
"""

import os
import sys
import shutil
import subprocess
import argparse
import time
from pathlib import Path

# 项目根目录
ROOT_DIR = Path(__file__).parent.parent
# Python 后端源码目录
SERVER_DIR = ROOT_DIR / "apps" / "server"
# 输出目录 (Electron 的 py-server 目录)
OUTPUT_DIR = ROOT_DIR / "apps" / "web" / "py-server"
# 临时构建目录
BUILD_DIR = ROOT_DIR / "build" / "server"


def subprocess_env() -> dict[str, str]:
    """子进程统一 UTF-8，避免 Windows GBK 解码 uv/PyInstaller 输出失败。"""
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    # CI/慢网络：拉长超时、走国内 PyPI 镜像、固定稳定 Python 版本
    env.setdefault("UV_HTTP_TIMEOUT", "300")
    env.setdefault("UV_HTTP_RETRIES", "5")
    env.setdefault("UV_INDEX_URL", "https://pypi.tuna.tsinghua.edu.cn/simple")
    env.setdefault("UV_PYTHON", "3.11")
    return env


def run_subprocess(
    cmd: list[str],
    *,
    cwd: Path,
    check: bool = True,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    kwargs: dict = {"cwd": cwd, "check": check, "env": subprocess_env()}
    if capture:
        kwargs.update(
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    return subprocess.run(cmd, **kwargs)


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="Python 后端打包脚本")
    parser.add_argument(
        "--clean",
        action="store_true",
        help="额外清理 build/server 临时目录（py-server 每次打包前默认清空）",
    )
    parser.add_argument(
        "--debug", action="store_true", help="启用调试模式，不删除临时文件"
    )
    parser.add_argument(
        "--app", action="store_true", help="打包 Python 后端后，再打包 Electron 应用"
    )
    return parser.parse_args()


def safe_rmtree(path: Path, *, retries: int = 5, delay_s: float = 0.5) -> None:
    """Windows 上 PyInstaller 可能短暂占用 work 目录，重试删除。"""
    if not path.exists():
        return

    last_error: OSError | None = None
    for attempt in range(retries):
        try:
            shutil.rmtree(path)
            return
        except OSError as err:
            last_error = err
            if attempt < retries - 1:
                time.sleep(delay_s * (attempt + 1))
    if last_error is not None:
        raise last_error


def clean_build(*, output: bool = True, work: bool = False) -> None:
    """清理构建产物。默认只清 py-server；--clean 时额外清 build/server。"""
    print("🧹 清理构建产物...")

    if output and OUTPUT_DIR.exists():
        safe_rmtree(OUTPUT_DIR)
        print(f"  已删除: {OUTPUT_DIR}")

    if work and BUILD_DIR.exists():
        safe_rmtree(BUILD_DIR)
        print(f"  已删除: {BUILD_DIR}")

    # 清理可能的 PyInstaller 临时 spec（遗留路径）
    for spec_file in (SERVER_DIR / "backend.spec", BUILD_DIR / "backend.spec"):
        if spec_file.exists():
            spec_file.unlink()
            print(f"  已删除: {spec_file}")

    print("✅ 清理完成")


def check_prerequisites():
    """检查前置条件"""
    print("🔍 检查前置条件...")

    # 检查 Python 后端目录
    if not SERVER_DIR.exists():
        print(f"❌ 错误: Python 后端目录不存在: {SERVER_DIR}")
        return False

    # 检查 start.py
    start_file = SERVER_DIR / "start.py"
    if not start_file.exists():
        print(f"❌ 错误: 启动文件不存在: {start_file}")
        return False

    # 检查 pyproject.toml
    pyproject_file = SERVER_DIR / "pyproject.toml"
    if not pyproject_file.exists():
        print(f"❌ 错误: pyproject.toml 不存在: {pyproject_file}")
        return False

    print("✅ 前置条件检查通过")
    return True


def install_dependencies():
    """安装 Python 依赖（包括 dev 依赖中的 pyinstaller）"""
    print("📦 安装 Python 依赖...")

    sync_cmd = [
        "uv",
        "sync",
        "--project",
        "digital-employee-client",
        "--group",
        "dev",
    ]
    max_attempts = 3

    for attempt in range(1, max_attempts + 1):
        try:
            run_subprocess(sync_cmd, cwd=ROOT_DIR, capture=True)
            print("✅ 依赖安装完成")
            return True
        except subprocess.CalledProcessError as e:
            detail = e.stderr or e.stdout or str(e)
            if attempt < max_attempts:
                print(f"⚠️  依赖安装失败，{max_attempts - attempt} 次重试剩余…")
                print(f"   错误: {detail[-2000:]}")
                time.sleep(10 * attempt)
                continue
            print("❌ 依赖安装失败:")
            print(f"   错误: {detail}")
            return False
        except FileNotFoundError:
            print("❌ 错误: 未找到 uv 命令，请安装 uv (https://github.com/astral-sh/uv)")
            return False

    return False


def run_pyinstaller():
    """运行 PyInstaller 打包"""
    print("🔨 运行 PyInstaller 打包...")

    # 清理上次 PyInstaller work 目录，避免 WinError 32 文件占用
    work_dir = BUILD_DIR / "work"
    if work_dir.exists():
        print(f"   清理临时工作目录: {work_dir}")
        safe_rmtree(work_dir)

    # 确保输出目录存在
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # PyInstaller 命令参数
    pyinstaller_args = [
        "uv",
        "run",
        "pyinstaller",
        "--onefile",  # 打包为单个可执行文件
        "--name",
        "backend",  # 输出文件名
        "--distpath",
        str(OUTPUT_DIR),  # 输出目录
        "--workpath",
        str(BUILD_DIR / "work"),  # 临时工作目录
        "--specpath",
        str(BUILD_DIR),  # spec 文件目录
        "--clean",  # 清理临时文件
        "--noconfirm",  # 不确认覆盖
    ]

    # 平台特定参数
    if sys.platform == "win32":
        # Windows 特定配置
        pyinstaller_args.extend(
            [
                "--console",  # 显示控制台窗口（便于调试）
                "--icon",
                "NONE",  # 无图标
            ]
        )
    elif sys.platform == "darwin":
        # macOS 特定配置
        pyinstaller_args.extend(
            [
                "--windowed",  # 无控制台窗口
            ]
        )
    else:
        # Linux 特定配置
        pyinstaller_args.extend(
            [
                "--console",  # 显示控制台窗口
            ]
        )

    # 添加隐藏导入（根据实际依赖调整）
    hidden_imports = [
        "pydantic",
        "sqlalchemy",
        "fastapi",
        "uvicorn",
        "langchain",
        "langchain_openai",
        "langchain_community",
        "deepagents",
        "activation_core",
        "activation_core.license",
        "activation_core.device",
    ]

    for module in hidden_imports:
        pyinstaller_args.extend(["--hidden-import", module])

    # 添加数据文件（数据库目录）
    data_dir = SERVER_DIR / "data"
    if data_dir.exists():
        pyinstaller_args.extend(["--add-data", f"{data_dir}{os.pathsep}data"])

    # 嵌入激活公钥（非 .py 数据文件，需显式打入）
    activation_pubkey = SERVER_DIR / "src" / "core" / "activation" / "public_key.pem"
    if activation_pubkey.exists():
        pyinstaller_args.extend(
            [
                "--add-data",
                f"{activation_pubkey}{os.pathsep}src/core/activation",
            ]
        )

    # 添加启动文件
    pyinstaller_args.append(str(SERVER_DIR / "start.py"))

    try:
        print(f"   运行命令: {' '.join(pyinstaller_args[:10])}...")
        run_subprocess(pyinstaller_args, cwd=SERVER_DIR, capture=True)

        # 检查输出文件
        exe_path = OUTPUT_DIR / (
            "backend.exe" if sys.platform == "win32" else "backend"
        )
        if exe_path.exists():
            file_size = exe_path.stat().st_size / (1024 * 1024)  # MB
            print(f"✅ 打包完成: {exe_path} ({file_size:.1f} MB)")
            return True
        else:
            print(f"❌ 错误: 输出文件不存在: {exe_path}")
            return False

    except subprocess.CalledProcessError as e:
        print("❌ PyInstaller 打包失败:")
        detail = e.stderr or e.stdout or str(e)
        print(f"   错误: {detail}")
        if sys.platform == "win32" and "WinError 32" in detail:
            print()
            print("💡 Windows 文件被占用，常见原因：")
            print("   1. 仍有 dev:server / dev:app 或 backend.exe 在运行")
            print("   2. 上次 PyInstaller 中断，work 目录未释放")
            print("   建议：关闭相关进程后重试 pnpm build:app:offline:clean")
        return False
    except FileNotFoundError:
        print("❌ 错误: 未找到 uv 命令，请安装 uv (https://github.com/astral-sh/uv)")
        return False


def copy_additional_files():
    """复制额外的文件到输出目录"""
    print("📋 复制额外文件...")

    # 复制 config-kv.init.json 作为参考
    env_example = SERVER_DIR / "config-kv.init.json"
    if env_example.exists():
        shutil.copy2(env_example, OUTPUT_DIR / "config-kv.init.json")
        print(f"   已复制: {env_example.name}")

    # 复制 README.md
    readme_file = SERVER_DIR / "README.md"
    if readme_file.exists():
        shutil.copy2(readme_file, OUTPUT_DIR / "README.md")
        print(f"   已复制: {readme_file.name}")

    # 复制内置技能目录，保证安装后有稳定路径可读取
    builtin_skills_dir = SERVER_DIR / "build-in-skills"
    target_builtin_skills_dir = OUTPUT_DIR / "build-in-skills"
    if builtin_skills_dir.exists():
        shutil.copytree(
            builtin_skills_dir,
            target_builtin_skills_dir,
            dirs_exist_ok=True,
        )
        print(f"   已复制目录: {builtin_skills_dir.name}")

    print("✅ 文件复制完成")


def main():
    """主函数"""
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
        
    args = parse_args()

    print("🚀 Python 后端打包脚本")
    print(f"   项目根目录: {ROOT_DIR}")
    print(f"   后端源码: {SERVER_DIR}")
    print(f"   输出目录: {OUTPUT_DIR}")
    print()

    # 每次打包前清 py-server，避免 .offline 等残留污染在线/离线安装包
    clean_build(output=True, work=args.clean)

    # 检查前置条件
    if not check_prerequisites():
        sys.exit(1)

    # 安装依赖
    if not install_dependencies():
        sys.exit(1)

    # 运行 PyInstaller
    if not run_pyinstaller():
        sys.exit(1)

    # 复制额外文件
    copy_additional_files()

    # 检查 backend.exe 是否成功产出
    exe_path = OUTPUT_DIR / ("backend.exe" if sys.platform == "win32" else "backend")
    if not exe_path.exists():
        print(f"❌ 错误: backend.exe 未成功产出，无法继续打包 Electron")
        sys.exit(1)

    # 清理临时文件（除非调试模式）
    if not args.debug and BUILD_DIR.exists():
        safe_rmtree(BUILD_DIR)
        print("🧹 已清理临时文件")

    print()
    print("🎉 Python 后端打包完成!")
    print(f"   可执行文件: {exe_path}")
    print()

    print("📝 使用说明:")
    print("   开发模式: pnpm dev:server")
    print("   构建后端: python scripts/build-server.py")
    print("   构建应用: python scripts/build-server.py --app")
       


if __name__ == "__main__":
    main()
