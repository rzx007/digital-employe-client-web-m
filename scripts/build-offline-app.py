#!/usr/bin/env python3
"""
离线应用打包脚本

1. 先调用 scripts/build-server.py 打包后端
2. 在 py-server 目录下写入 .offline 标记文件
3. 调用 pnpm --filter digital-employee build:app:offline 打包 Electron (使用离线配置)

使用方法:
    python scripts/build-offline-app.py [--clean] [--debug]
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
OUTPUT_DIR = ROOT_DIR / "apps" / "web" / "py-server"

def parse_args():
    parser = argparse.ArgumentParser(description="离线应用打包脚本")
    parser.add_argument("--clean", action="store_true", help="额外清理 build/server 临时目录")
    parser.add_argument("--debug", action="store_true", help="启用调试模式，不删除临时文件")
    return parser.parse_args()

def main():
    # Fix for Windows console emoji printing
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding='utf-8')
        
    args = parse_args()
    print("🚀 开始打包离线应用...")

    # 1. 打包后端
    build_server_cmd = [sys.executable, str(ROOT_DIR / "scripts" / "build-server.py")]
    if args.clean:
        build_server_cmd.append("--clean")
    if args.debug:
        build_server_cmd.append("--debug")
        
    print(f"📦 步骤 1: 打包后端 ({' '.join(build_server_cmd)})")
    try:
        subprocess.run(build_server_cmd, cwd=ROOT_DIR, check=True)
    except subprocess.CalledProcessError:
        print("❌ 后端打包失败，终止离线打包流程。")
        sys.exit(1)

    # 2. 写入 .offline 标记
    print("📝 步骤 2: 写入离线标记文件...")
    if not OUTPUT_DIR.exists():
        print(f"❌ 错误: 后端输出目录不存在: {OUTPUT_DIR}")
        sys.exit(1)
        
    offline_marker = OUTPUT_DIR / ".offline"
    try:
        offline_marker.write_text("offline=1", encoding="utf-8")
        print(f"   已写入: {offline_marker}")
    except Exception as e:
        print(f"❌ 写入离线标记失败: {e}")
        sys.exit(1)

    # 3. 打包 Electron
    print("🖥️ 步骤 3: 打包 Electron (离线配置)...")
    electron_cmd = ["pnpm", "--filter", "digital-employee", "build:app:offline"]
    # Windows 上 subprocess 调 pnpm 需要 shell=True 或者用 pnpm.cmd
    shell = sys.platform == "win32"
    try:
        subprocess.run(electron_cmd, cwd=ROOT_DIR, check=True, shell=shell)
    except subprocess.CalledProcessError:
        print("❌ Electron 打包失败。")
        sys.exit(1)
        
    print()
    print("🎉 离线应用打包完成!")
    print(f"   产物目录: {ROOT_DIR / 'apps' / 'web' / 'release'}")
    print("   提示: 安装后可通过访问 GET /system/runtime 验证 offline_mode 是否为 true。")

if __name__ == "__main__":
    main()
