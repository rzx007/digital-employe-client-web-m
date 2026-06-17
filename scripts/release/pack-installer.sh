#!/usr/bin/env bash
# 把完整 BobanStaff-Installer 目录拆成 核心包 + 模型包 两个 zip。
# 用法: pack-installer.sh <installer_dir> [out_dir=./dist]
set -uo pipefail

INST="${1:?用法: pack-installer.sh <installer_dir> [out_dir]}"
OUT="${2:-./dist}"
INST="$(cd "$INST" && pwd)"

[[ -f "$INST/deploy.sh" ]] || { echo "✗ 缺 deploy.sh: $INST" >&2; exit 1; }
[[ -d "$INST/packages" ]]  || { echo "✗ 缺 packages/" >&2; exit 1; }

deb="$(ls -1v "$INST"/packages/DigitalEmployee-Offline-Linux-arm64-*.deb 2>/dev/null \
        | grep -vE 'debbak' | tail -1)"
[[ -n "$deb" ]] || { echo "✗ packages/ 无数字员工 .deb" >&2; exit 1; }
ver="$(basename "$deb" | sed -E 's/.*-([0-9]+\.[0-9]+\.[0-9]+)\.deb/\1/')"

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
core="$OUT/BobanStaff-Core-${ver}.zip"
model="$OUT/BobanStaff-Model.zip"
rm -f "$core" "$model"

cd "$INST"

echo "» 打核心包 $core ..."
zip -q "$core" deploy.sh >/dev/null
find packages -type f ! -name '*.debbak*' -print0 | xargs -0 zip -q "$core"
[[ -d ime ]] && find ime -type f -print0 | xargs -0 zip -q "$core" 2>/dev/null || true
find runtime -maxdepth 1 -type f -name 'docker-compose.yml*' -print0 | xargs -0 zip -q "$core" 2>/dev/null || true

echo "» 打模型包 $model ..."
find runtime -maxdepth 1 -type f -name '*.gguf' -print0 | xargs -0 zip -q "$model" 2>/dev/null || true
[[ -d images ]] && find images -type f -name '*.tar' -print0 | xargs -0 zip -q "$model" 2>/dev/null || true

( cd "$OUT" && sha256sum "$(basename "$core")" > "$(basename "$core").sha256" )
[[ -f "$model" ]] && ( cd "$OUT" && sha256sum "$(basename "$model")" > "$(basename "$model").sha256" )

echo "✓ 完成 (版本 $ver)"
echo "  核心包: $core  ($(du -h "$core" | cut -f1))"
[[ -f "$model" ]] && echo "  模型包: $model  ($(du -h "$model" | cut -f1))"
