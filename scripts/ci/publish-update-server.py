#!/usr/bin/env python3
"""
把 electron 自动更新产物推到 nginx 更新服务器对应平台目录（win32/macos/linux）。

为什么要这个脚本：
  electron-updater 只读 `<feed>/<platform>/latest*.yml` 判断有没有新版，**根本不看你手传的
  安装包**。只传 exe 不更新 latest.yml = 客户端永远看不到新版。本脚本把 installer 和
  latest.yml（必要时按 installer 现算 sha512/size 重新生成）一起推上去，彻底杜绝「忘传
  latest.yml / latest.yml 版本对不上 / 漏传 blockmap」这类坑。

更新源由客户端从后端 KV `REMOTE_API_BASE_URL` 解析为 `<base>/<platform>`（见
  apps/web/electron/features/update/auto-updater.ts）。本脚本把文件推到
  `<远端目录base>/<platform>/`，与之对应。

凭据走环境变量（**勿写入仓库**，在 GitLab CI/CD Variables 里配，Masked）：
  目标 test：UPDATE_TEST_HOST / UPDATE_TEST_USER / UPDATE_TEST_PASS / UPDATE_TEST_BASE
  目标 prod：UPDATE_PROD_HOST / UPDATE_PROD_USER / UPDATE_PROD_PASS / UPDATE_PROD_BASE
  其中 BASE 是平台目录的上一层（脚本自动追加 /<platform>）。

用法：
  python publish-update-server.py --platform win32 --target test
  python publish-update-server.py --platform win32 --target prod
  python publish-update-server.py --platform win32 --target test --dry-run
  # 版本号默认取 CI_COMMIT_TAG（去掉 v），否则从安装包文件名解析

依赖：paramiko（CI 里若无，先 `pip install paramiko`）。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# 控制台编码自防：Windows 默认 GBK，中文日志会 UnicodeEncodeError。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parents[2]
RELEASE_DIRS = [ROOT / "apps/web/release", ROOT / "release"]

# 每个平台：latest*.yml 文件名 + 安装包候选后缀（按优先级）
PLATFORM_SPEC = {
    "win32": {"yml": "latest.yml", "installer": ["-Setup.exe", ".exe"]},
    "macos": {"yml": "latest-mac.yml", "installer": [".zip", ".dmg"]},
    "linux": {"yml": "latest-linux.yml", "installer": [".AppImage", ".deb"]},
}


def log(msg: str) -> None:
    print(msg, flush=True)


def die(msg: str, code: int = 1) -> None:
    log(f"✗ {msg}")
    sys.exit(code)


def env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def find_release_dir() -> Path:
    for d in RELEASE_DIRS:
        if d.is_dir():
            return d
    die(f"未找到 release 目录：{[str(x) for x in RELEASE_DIRS]}")
    raise AssertionError  # unreachable


def find_installer(release: Path, platform: str) -> Path:
    spec = PLATFORM_SPEC[platform]
    # blockmap / yml 不算安装包；按后缀优先级挑第一个匹配的真实安装包
    for suffix in spec["installer"]:
        cands = sorted(
            p for p in release.iterdir()
            if p.is_file()
            and p.name.endswith(suffix)
            and not p.name.endswith(".blockmap")
        )
        if cands:
            # 多个时取版本号最高
            return max(cands, key=lambda p: _ver_key(p.name))
    die(f"release 目录 {release} 里找不到 {platform} 安装包（{spec['installer']}）")
    raise AssertionError  # unreachable


def _ver_key(name: str) -> tuple[int, ...]:
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", name)
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def resolve_version(installer: Path) -> str:
    tag = env("CI_COMMIT_TAG")
    if tag:
        return tag[1:] if tag.lower().startswith("v") else tag
    m = re.search(r"(\d+\.\d+\.\d+)", installer.name)
    if m:
        return m.group(1)
    die(f"无法确定版本号（CI_COMMIT_TAG 未设且文件名无版本）：{installer.name}")
    raise AssertionError  # unreachable


def sha512_b64(path: Path) -> str:
    h = hashlib.sha512()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode("ascii")


def build_manifest(installer: Path, version: str) -> str:
    """按 electron-updater 格式生成 latest*.yml（不含 blockmap，差量退化为全量下载）。"""
    sha = sha512_b64(installer)
    size = installer.stat().st_size
    date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return (
        f"version: {version}\n"
        f"files:\n"
        f"  - url: {installer.name}\n"
        f"    sha512: {sha}\n"
        f"    size: {size}\n"
        f"path: {installer.name}\n"
        f"sha512: {sha}\n"
        f"releaseDate: '{date}'\n"
    )


def target_conf(target: str) -> dict[str, str]:
    pre = f"UPDATE_{target.upper()}_"
    conf = {k: env(pre + k) for k in ("HOST", "USER", "PASS", "BASE")}
    missing = [pre + k for k, v in conf.items() if not v]
    if missing:
        die(f"目标 {target} 缺少环境变量：{missing}（在 GitLab CI/CD Variables 配置）")
    return conf


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", required=True, choices=list(PLATFORM_SPEC))
    ap.add_argument("--target", required=True, choices=["test", "prod"])
    ap.add_argument("--release-dir", default=None, help="覆盖 release 目录")
    ap.add_argument("--version", default=None, help="覆盖版本号（默认取 CI_COMMIT_TAG）")
    ap.add_argument("--dry-run", action="store_true", help="只打印不上传")
    args = ap.parse_args()

    release = Path(args.release_dir) if args.release_dir else find_release_dir()
    installer = find_installer(release, args.platform)
    version = args.version or resolve_version(installer)
    spec = PLATFORM_SPEC[args.platform]

    # 优先用构建产物里的 latest.yml（保留差量 blockmap）；没有则按安装包现算重生成
    build_yml = release / spec["yml"]
    blockmap = installer.with_name(installer.name + ".blockmap")
    use_build_yml = build_yml.is_file()

    log(f"» 平台 {args.platform} · 目标 {args.target} · 版本 {version}")
    log(f"  安装包: {installer.name} ({installer.stat().st_size:,} B)")
    log(f"  manifest: {'构建产物 ' + spec['yml'] if use_build_yml else '按安装包现算重生成'}")
    log(f"  blockmap: {'有，一并上传' if blockmap.is_file() else '无（差量退化为全量下载）'}")

    # 待上传清单：安装包/blockmap 走磁盘流式 put；manifest 走内存写。
    # latest.yml 最后传——先把安装包落好，避免客户端读到新 yml 但包还没到位。
    file_uploads: list[Path] = [installer]
    if blockmap.is_file():
        file_uploads.append(blockmap)
    manifest_bytes = (
        build_yml.read_bytes() if use_build_yml
        else build_manifest(installer, version).encode("utf-8")
    )

    conf = target_conf(args.target)
    remote_dir = conf["BASE"].rstrip("/") + "/" + args.platform
    log(f"  目标: {conf['USER']}@{conf['HOST']}:{remote_dir}/")

    if args.dry_run:
        for p in file_uploads:
            log(f"  [dry-run] 将上传 {p.name} ({p.stat().st_size:,} B)")
        log(f"  [dry-run] 将写入 {spec['yml']} ({len(manifest_bytes):,} B)")
        return 0

    try:
        import paramiko  # noqa: PLC0415
    except ImportError:
        die("缺少 paramiko：CI 里先 `pip install paramiko`，或本机 `pip install paramiko`")

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(
        conf["HOST"], username=conf["USER"], password=conf["PASS"],
        timeout=20, allow_agent=False, look_for_keys=False,
    )
    try:
        sftp = cli.open_sftp()
        # 确保平台目录存在
        _mkdirs(sftp, remote_dir)
        for p in file_uploads:
            sftp.put(str(p), f"{remote_dir}/{p.name}")
            log(f"  ✓ 上传 {p.name} ({p.stat().st_size:,} B)")
        with sftp.open(f"{remote_dir}/{spec['yml']}", "w") as f:
            f.write(manifest_bytes)
        log(f"  ✓ 写入 {spec['yml']} ({len(manifest_bytes):,} B)")
        # 回读校验 latest.yml 版本
        with sftp.open(f"{remote_dir}/{spec['yml']}", "r") as f:
            head = f.read().decode("utf-8", "replace").splitlines()[0]
        log(f"  校验: {spec['yml']} → {head}")
        sftp.close()
    finally:
        cli.close()

    log(f"✓ 完成：{args.platform} → {args.target}（版本 {version}）")
    return 0


def _mkdirs(sftp, path: str) -> None:
    parts = path.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)


if __name__ == "__main__":
    sys.exit(main())
