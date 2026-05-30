#!/usr/bin/env python3
"""将 license-issuer 打包为单文件可执行文件（PyInstaller）。

用法（仓库根目录）：
    python apps/license-issuer/scripts/build-binary.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ISSUER_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = ISSUER_DIR.parents[1]
BUILD_DIR = ISSUER_DIR / "build"
RELEASE_DIR = ISSUER_DIR / "release"


def main() -> int:
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)

    name = "de-license"
    pyinstaller_args = [
        "uv",
        "run",
        "pyinstaller",
        "--onefile",
        "--name",
        name,
        "--distpath",
        str(RELEASE_DIR),
        "--workpath",
        str(BUILD_DIR / "work"),
        "--specpath",
        str(BUILD_DIR),
        "--clean",
        "--noconfirm",
        "--console",
        "--hidden-import",
        "activation_core",
        "--hidden-import",
        "activation_core.license",
        "--hidden-import",
        "activation_core.device",
        "--hidden-import",
        "cryptography",
        "--collect-submodules",
        "activation_core",
    ]

    # Typer entry: console script wrapper
    wrapper = BUILD_DIR / "_entry.py"
    wrapper.write_text(
        "from license_issuer.cli import app\n"
        "if __name__ == '__main__':\n"
        "    app()\n",
        encoding="utf-8",
    )
    pyinstaller_args.append(str(wrapper))

    print("Building license-issuer binary...")
    try:
        subprocess.run(pyinstaller_args, cwd=ISSUER_DIR, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"PyInstaller failed: {exc}")
        return 1

    ext = ".exe" if sys.platform == "win32" else ""
    out = RELEASE_DIR / f"{name}{ext}"
    if out.exists():
        print(f"Done: {out}")
        print(
            "Deploy: place organization private_key.pem next to the executable "
            f"in {RELEASE_DIR}"
        )
        return 0
    print("Build finished but output not found.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
