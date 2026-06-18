#!/usr/bin/env bash
# 把完整 BobanStaff-Installer 目录拆成 核心包 + 模型包 两个 zip。
# 用法: pack-installer.sh <installer_dir> [out_dir=./dist]
set -uo pipefail

INST="${1:?用法: pack-installer.sh <installer_dir> [out_dir]}"
OUT="${2:-./dist}"
INST="$(cd "$INST" && pwd)"

[[ -f "$INST/deploy.sh" ]] || { echo "✗ 缺 deploy.sh: $INST" >&2; exit 1; }
[[ -d "$INST/packages" ]]  || { echo "✗ 缺 packages/" >&2; exit 1; }

# 兼容两种 deb 命名：BobanStaff-Linux-arm64-* / DigitalEmployee-Offline-Linux-arm64-*。
# 选版本号最高的——按提取出的版本号(而非文件名字符串)排序，避免前缀字母干扰排序。
deb=""; ver=""
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  v="$(basename "$f" | sed -E 's/.*-([0-9]+\.[0-9]+\.[0-9]+)\.deb$/\1/')"
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
  if [[ -z "$ver" ]] || [[ "$(printf '%s\n%s\n' "$ver" "$v" | sort -V | tail -1)" == "$v" ]]; then
    ver="$v"; deb="$f"
  fi
done < <(ls -1 "$INST"/packages/*Linux-arm64-*.deb 2>/dev/null | grep -vE 'debbak')
[[ -n "$deb" ]] || { echo "✗ packages/ 无数字员工 .deb" >&2; exit 1; }

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
core="$OUT/BobanStaff-Core-${ver}.zip"
model="$OUT/BobanStaff-Model.zip"
rm -f "$core" "$model"

cd "$INST"

echo "» 打核心包 $core ..."
zip -q "$core" deploy.sh >/dev/null
# packages：排除所有 .deb / .debbak（旧版本不进包）；也排除 activation.md（已废弃，现场改用 license.code）。
find packages -type f ! -name '*.deb' ! -name '*.debbak*' ! -name 'activation.md' -print0 | xargs -0 zip -q "$core" 2>/dev/null || true
# 只把最高版那个数字员工 deb 加进去
zip -q "$core" "packages/$(basename "$deb")" >/dev/null
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
