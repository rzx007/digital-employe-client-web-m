#!/usr/bin/env python3
"""publish-update-server.py 纯逻辑单测（无网络）。运行：python scripts/ci/test-publish-update-server.py"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pus", HERE / "publish-update-server.py")
assert spec and spec.loader
pus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pus)

PASS = 0
FAIL = 0


def check(name: str, expected, actual) -> None:
    global PASS, FAIL
    if expected == actual:
        print(f"PASS: {name}")
        PASS += 1
    else:
        print(f"FAIL: {name}\n  expected: {expected!r}\n  actual:   {actual!r}")
        FAIL += 1


# find_installer：多版本取最高，排除 blockmap
rel = Path(tempfile.mkdtemp())
for fn in (
    "BobanStaff-Windows-0.1.3-Setup.exe",
    "BobanStaff-Windows-0.1.18-Setup.exe",
    "BobanStaff-Windows-0.1.18-Setup.exe.blockmap",
    "latest.yml",
):
    (rel / fn).write_bytes(b"x")
check("find_installer 取最高版", "BobanStaff-Windows-0.1.18-Setup.exe",
      pus.find_installer(rel, "win32").name)

# resolve_version：CI_COMMIT_TAG 优先（去 v）
os.environ["CI_COMMIT_TAG"] = "v0.1.18"
check("resolve_version 取 tag 去 v", "0.1.18",
      pus.resolve_version(rel / "BobanStaff-Windows-0.1.3-Setup.exe"))
# 无 tag → 从文件名解析
del os.environ["CI_COMMIT_TAG"]
check("resolve_version 退回文件名", "0.1.3",
      pus.resolve_version(rel / "BobanStaff-Windows-0.1.3-Setup.exe"))

# build_manifest：含 version/sha512/size/path，格式可被 electron-updater 解析
installer = rel / "BobanStaff-Windows-0.1.18-Setup.exe"
installer.write_bytes(b"hello-update")
m = pus.build_manifest(installer, "0.1.18")
check("manifest 含 version", True, "version: 0.1.18" in m)
check("manifest 含 url", True, "url: BobanStaff-Windows-0.1.18-Setup.exe" in m)
check("manifest 含 path", True, "path: BobanStaff-Windows-0.1.18-Setup.exe" in m)
check("manifest sha512 两处一致",
      m.count(pus.sha512_b64(installer)), 2)
check("manifest 含 size", True, f"size: {installer.stat().st_size}" in m)

# target_conf：缺变量应退出（die → SystemExit）
for k in ("HOST", "USER", "PASS", "BASE"):
    os.environ.pop(f"UPDATE_TEST_{k}", None)
try:
    pus.target_conf("test")
    check("缺凭据应退出", "SystemExit", "no-exit")
except SystemExit:
    check("缺凭据应退出", "SystemExit", "SystemExit")

import shutil
shutil.rmtree(rel, ignore_errors=True)
print("----")
print(f"PASS={PASS} FAIL={FAIL}")
sys.exit(1 if FAIL else 0)
