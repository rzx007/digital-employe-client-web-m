#!/usr/bin/env python3
"""将管理员导出的公钥写入客户端嵌入路径。

用法：
    python scripts/activation/embed-public-key.py path/to/public_key.pem
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "apps" / "server" / "src" / "core" / "activation" / "public_key.pem"


def main() -> int:
    parser = argparse.ArgumentParser(description="嵌入激活公钥到 apps/server")
    parser.add_argument("public_key", type=Path, help="公钥 PEM 文件路径")
    args = parser.parse_args()
    src = args.public_key.expanduser()
    if not src.exists():
        print(f"文件不存在: {src}")
        return 1
    TARGET.write_bytes(src.read_bytes())
    print(f"已写入: {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
