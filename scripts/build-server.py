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


# 国内 PyPI 镜像（勿用 uv sync --frozen/--locked，会直链 files.pythonhosted.org）
PYPI_MIRROR = "https://mirrors.aliyun.com/pypi/simple/"
PYPI_MIRROR_FALLBACK = "https://npmmirror.com/mirror/pypi/simple"


def _resolve_uv_cache_dir() -> str:
    """优先 yaoji 账户缓存；CI 可通过 UV_CACHE_DIR 覆盖。"""
    explicit = os.environ.get("UV_CACHE_DIR", "").strip()
    if explicit:
        return explicit

    yaoji_cache = Path("C:/Users/yaoji/AppData/Local/uv-cache")
    if yaoji_cache.parent.parent.exists():
        return str(yaoji_cache)

    ci_project = os.environ.get("CI_PROJECT_DIR", "").strip()
    if ci_project:
        runner_root = Path(ci_project).parent.parent
        return str(runner_root / "uv-cache")

    return str(Path.home() / ".cache" / "uv")


def _ensure_writable_cache(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    probe = path / ".write-test"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return path
    except OSError:
        fallback = Path(os.environ.get("TEMP", os.environ.get("TMP", "."))) / "uv-cache"
        fallback.mkdir(parents=True, exist_ok=True)
        print(f"⚠️  uv 缓存不可写 {path}，改用 {fallback}", flush=True)
        return fallback


def subprocess_env() -> dict[str, str]:
    """子进程统一 UTF-8，避免 Windows GBK 解码 uv/PyInstaller 输出失败。"""
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env.setdefault("UV_HTTP_TIMEOUT", "300")
    env.setdefault("UV_HTTP_RETRIES", "5")
    env.setdefault("UV_CONCURRENT_DOWNLOADS", "16")
    env.setdefault("UV_INDEX_URL", PYPI_MIRROR)
    env.setdefault("UV_EXTRA_INDEX_URL", PYPI_MIRROR_FALLBACK)
    cache_dir = _ensure_writable_cache(Path(_resolve_uv_cache_dir()))
    env["UV_CACHE_DIR"] = str(cache_dir)
    resolve_uv_python(env)
    return env


def _uv_sync_cmd(env: dict[str, str]) -> list[str]:
    """uv sync：版本由 uv.lock 约束，下载走国内镜像（禁用 frozen/locked）。"""
    mirror = env.get("UV_INDEX_URL", PYPI_MIRROR)
    extra = env.get("UV_EXTRA_INDEX_URL", PYPI_MIRROR_FALLBACK)
    cmd = [
        "uv",
        "sync",
        "--project",
        "apps/server",
        "--group",
        "dev",
        "--default-index",
        mirror,
        "--index",
        extra,
    ]
    if os.environ.get("CI", "").lower() in ("1", "true"):
        cmd.append("-v")
    return cmd


_PY_BIT_CHECK = (
    "import sys; "
    "assert sys.maxsize > 2**32, 'need 64-bit Python'; "
    "print(sys.executable)"
)


def _is_64bit_python(exe: str) -> bool:
    normalized = exe.replace("\\", "/").lower()
    if "-32" in normalized or "python311-32" in normalized:
        return False
    try:
        result = subprocess.run(
            [exe, "-c", _PY_BIT_CHECK],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=True,
        )
        return bool((result.stdout or "").strip())
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return False


def _windows_direct_python_exes() -> list[Path]:
    """GitLab Runner 服务账户可能无 py 启动器，直接探测常见安装路径。"""
    seen: set[str] = set()
    out: list[Path] = []

    def add(path: Path) -> None:
        key = str(path)
        if key not in seen and path.is_file():
            seen.add(key)
            out.append(path)

    env_roots: list[Path] = []
    for key in ("LOCALAPPDATA", "ProgramFiles"):
        val = os.environ.get(key, "")
        if val:
            env_roots.append(Path(val))
    userprofile = os.environ.get("USERPROFILE", "")
    if userprofile:
        env_roots.append(Path(userprofile) / "AppData" / "Local")

    for root in env_roots:
        for ver in ("Python311", "Python312"):
            add(root / "Programs" / "Python" / ver / "python.exe")
            add(root / ver / "python.exe")

    return out


def _windows_py_launcher_exes() -> list[str]:
    launchers: list[str] = []
    for candidate in (
        shutil.which("py"),
        os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "py.exe"),
        r"C:\Windows\py.exe",
    ):
        if candidate and candidate not in launchers and Path(candidate).is_file():
            launchers.append(candidate)
    return launchers


def resolve_uv_python(env: dict[str, str]) -> None:
    current = env.get("UV_PYTHON", "").strip()
    if current and _is_64bit_python(current):
        print(f"🐍 使用 Python: {current}")
        return
    if current:
        print(f"⚠️  忽略无效 UV_PYTHON（需 64 位）: {current}")

    if sys.platform == "win32":
        for exe_path in _windows_direct_python_exes():
            exe = str(exe_path)
            if _is_64bit_python(exe):
                env["UV_PYTHON"] = exe
                print(f"🐍 使用 Python: {exe}")
                return

        py_args = ["-3.11-64", "-3.12-64", "-3.11", "-3.12"]
        for py_exe in _windows_py_launcher_exes():
            for arg in py_args:
                try:
                    result = subprocess.run(
                        [py_exe, arg, "-c", _PY_BIT_CHECK],
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        check=True,
                    )
                    exe = (result.stdout or "").strip()
                    if exe and _is_64bit_python(exe):
                        env["UV_PYTHON"] = exe
                        print(f"🐍 使用 Python: {exe}")
                        return
                except (subprocess.CalledProcessError, FileNotFoundError, OSError):
                    continue
    else:
        for cmd in (["python3"], ["python"]):
            try:
                result = subprocess.run(
                    [*cmd, "-c", _PY_BIT_CHECK],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=True,
                )
                exe = (result.stdout or "").strip()
                if exe and _is_64bit_python(exe):
                    env["UV_PYTHON"] = exe
                    print(f"🐍 使用 Python: {exe}")
                    return
            except (subprocess.CalledProcessError, FileNotFoundError):
                continue

    env.pop("UV_PYTHON", None)


def _stream_subprocess() -> bool:
    """CI / 终端下实时打印子进程输出，避免长时间无日志。"""
    ci = os.environ.get("CI", "").lower()
    return ci in ("1", "true") or sys.stdout.isatty()


def run_subprocess(
    cmd: list[str],
    *,
    cwd: Path,
    check: bool = True,
    capture: bool = False,
    stream: bool | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    if stream is None:
        stream = _stream_subprocess() and not capture

    run_env = env if env is not None else subprocess_env()

    if stream:
        print(f"   $ {' '.join(cmd)}", flush=True)
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            env=run_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            print(line, end="", flush=True)
        returncode = process.wait()
        if check and returncode != 0:
            raise subprocess.CalledProcessError(returncode, cmd)
        return subprocess.CompletedProcess(cmd, returncode)

    kwargs: dict = {
        "cwd": cwd,
        "check": check,
        "env": run_env,
    }
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
    parser.add_argument(
        "--sync-only",
        action="store_true",
        help="仅 uv sync 安装依赖，不跑 PyInstaller",
    )
    parser.add_argument(
        "--pack-only",
        action="store_true",
        help="跳过 uv sync，仅 PyInstaller 打包（需 .venv 已就绪）",
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

    env = subprocess_env()
    if not env.get("UV_PYTHON"):
        print("❌ 未找到可用的 64 位 Python 3.11+")
        print("   Runner 当前仅有 32 位 Python（Python311-32），无法打包后端。")
        print("   请安装 64 位 Python 3.11：https://www.python.org/downloads/release/python-3119/")
        print("   安装后执行: py -3.11-64 -c \"import sys; print(sys.executable)\"")
        return False

    sync_base = _uv_sync_cmd(env)
    print(f"   PyPI 镜像: {env.get('UV_INDEX_URL')}", flush=True)
    print(f"   uv 缓存: {env.get('UV_CACHE_DIR')}", flush=True)

    try:
        # 1) 先装锁定依赖（含 dev 组 hatchling/setuptools），暂不构建 workspace
        run_subprocess(
            sync_base + ["--no-install-workspace"],
            cwd=ROOT_DIR,
            env=env,
        )
        # 2) 用 venv 内 build 工具构建 workspace 可编辑包
        run_subprocess(
            sync_base + ["--no-build-isolation"],
            cwd=ROOT_DIR,
            env=env,
        )
        print("✅ 依赖安装完成")
        return True
    except subprocess.CalledProcessError as e:
        detail = e.stderr or e.stdout or str(e)
        print("❌ 依赖安装失败:")
        print(f"   错误: {detail}")
        return False
    except FileNotFoundError:
        print("❌ 错误: 未找到 uv 命令，请安装 uv (https://github.com/astral-sh/uv)")
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
        "--noupx",  # 避免 UPX 压缩拖慢构建
        "--log-level",
        "INFO",
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

    # 排除后端未使用的大模块，缩短 PyInstaller 分析时间
    exclude_modules = (
        "matplotlib",
        "tkinter",
        "unittest",
        "test",
        "tests",
        "IPython",
        "jupyter",
        "notebook",
        "scipy",
        "pandas",
        "pip",
        "wheel",
    )
    for module in exclude_modules:
        pyinstaller_args.extend(["--exclude-module", module])

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
        print(f"   运行命令: {' '.join(pyinstaller_args[:12])}...", flush=True)
        print(
            "   ⏳ PyInstaller 分析 LangChain 依赖树较慢，CI 上 10～20 分钟属正常，"
            "请观察下方实时日志…",
            flush=True,
        )
        t0 = time.perf_counter()
        run_subprocess(pyinstaller_args, cwd=SERVER_DIR)
        elapsed = time.perf_counter() - t0
        print(f"   PyInstaller 耗时 {elapsed / 60:.1f} 分钟", flush=True)

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
    if args.sync_only and args.pack_only:
        print("❌ 不能同时使用 --sync-only 与 --pack-only")
        sys.exit(1)

    print("🚀 Python 后端打包脚本")
    print(f"   项目根目录: {ROOT_DIR}")
    print(f"   后端源码: {SERVER_DIR}")
    print(f"   输出目录: {OUTPUT_DIR}")
    print()

    if not args.sync_only:
        # 每次打包前清 py-server，避免 .offline 等残留污染在线/离线安装包
        clean_build(output=True, work=args.clean)

    # 检查前置条件
    if not check_prerequisites():
        sys.exit(1)

    total_t0 = time.perf_counter()

    if not args.pack_only:
        t0 = time.perf_counter()
        if not install_dependencies():
            sys.exit(1)
        print(f"⏱️  uv sync 耗时 {(time.perf_counter() - t0) / 60:.1f} 分钟", flush=True)

    if args.sync_only:
        print()
        print("✅ Python 依赖安装完成 (--sync-only)")
        sys.exit(0)

    # 运行 PyInstaller
    t0 = time.perf_counter()
    if not run_pyinstaller():
        sys.exit(1)
    print(f"⏱️  PyInstaller 阶段耗时 {(time.perf_counter() - t0) / 60:.1f} 分钟", flush=True)

    # 复制额外文件
    copy_additional_files()

    # 检查 backend.exe 是否成功产出
    exe_path = OUTPUT_DIR / ("backend.exe" if sys.platform == "win32" else "backend")
    if not exe_path.exists():
        print("❌ 错误: backend.exe 未成功产出，无法继续打包 Electron")
        sys.exit(1)

    # 清理临时文件（除非调试模式）
    if not args.debug and BUILD_DIR.exists():
        safe_rmtree(BUILD_DIR)
        print("🧹 已清理临时文件")

    total_min = (time.perf_counter() - total_t0) / 60
    print()
    print("🎉 Python 后端打包完成!")
    print(f"   可执行文件: {exe_path}")
    print(f"   总耗时: {total_min:.1f} 分钟")
    print()

    print("📝 使用说明:")
    print("   开发模式: pnpm dev:server")
    print("   仅装依赖: python scripts/build-server.py --sync-only")
    print("   仅打包:   python scripts/build-server.py --pack-only")
    print("   完整构建: python scripts/build-server.py")
       


if __name__ == "__main__":
    main()
