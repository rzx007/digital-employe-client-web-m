#!/usr/bin/env bash
# 把完整 BobanStaff-Installer 目录打成 核心包 + 模型包 两个 zip。
# 核心包【不含】数字员工 deb——deb 体积大、版本更新频繁，改为内置一份「去哪下最新 deb」
# 说明（指向飞书部署文档）。装机时按文档下载对应 Linux/arm64 deb 放进 packages/ 再跑 deploy.sh。
set -uo pipefail

INST="${1:?用法: pack-installer.sh <installer_dir> [out_dir]}"
OUT="${2:-./dist}"
INST="$(cd "$INST" && pwd)"

[[ -f "$INST/deploy.sh" ]] || { echo "✗ 缺 deploy.sh: $INST" >&2; exit 1; }
[[ -d "$INST/packages" ]]  || { echo "✗ 缺 packages/" >&2; exit 1; }

# 飞书部署文档（含最新数字员工 deb 的获取方式）
DEB_DOC_URL="https://scnj8otdvysf.feishu.cn/wiki/EqwFw68sRixBUukRgApcgHiPnDc"

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
core="$OUT/BobanStaff-Core.zip"
model="$OUT/BobanStaff-Model.zip"
rm -f "$core" "$model" "$core.sha256" "$model.sha256"

cd "$INST"

# 生成「去哪下 deb」说明，放进 packages/ 随核心包一起打；打完即删（不污染安装器目录）
NOTE_REL="packages/数字员工deb-下载说明.txt"
cleanup() { rm -f "$INST/$NOTE_REL"; }
trap cleanup EXIT
cat > "$INST/$NOTE_REL" <<EOF
数字员工安装包（.deb）获取说明
================================

本核心包【不含】数字员工 .deb（体积大、版本更新频繁）。
装机前请到飞书「部署文档」下载最新 Linux/arm64 的 .deb：

  ${DEB_DOC_URL}

步骤：
  1) 在飞书部署文档里下载最新版数字员工 deb
     （形如 DigitalEmployee-Offline-Linux-arm64-<版本>.deb）。
  2) 放进本目录 packages/，并删掉旧的 *.deb（避免装到旧版）。
  3) 运行 deploy.sh —— 会自动选 packages/ 内版本号最高的 deb 安装。
EOF

echo "» 打核心包 $core ..."
zip -q "$core" deploy.sh >/dev/null
# packages：排除所有 .deb/.debbak（deb 改为按文档下载）与已废弃 activation.md；
# 其余文件（cli / SHA256SUMS / 上面的下载说明）照打。
find packages -type f ! -name '*.deb' ! -name '*.debbak*' ! -name 'activation.md' -print0 | xargs -0 zip -q "$core" 2>/dev/null || true
[[ -d ime ]] && find ime -type f -print0 | xargs -0 zip -q "$core" 2>/dev/null || true
find runtime -maxdepth 1 -type f -name 'docker-compose.yml*' -print0 | xargs -0 zip -q "$core" 2>/dev/null || true
# 核心包 sha 紧跟核心包生成——即便后面模型包失败/中断，核心包也已完整可校验。
( cd "$OUT" && sha256sum "$(basename "$core")" > "$(basename "$core").sha256" )

# 模型包（体积大）。SKIP_MODEL=1 可只打核心包。
if [[ -z "${SKIP_MODEL:-}" ]]; then
  echo "» 打模型包 $model ..."
  find runtime -maxdepth 1 -type f -name '*.gguf' -print0 | xargs -0 zip -q "$model" 2>/dev/null || true
  [[ -d images ]] && find images -type f -name '*.tar' -print0 | xargs -0 zip -q "$model" 2>/dev/null || true
  [[ -f "$model" ]] && ( cd "$OUT" && sha256sum "$(basename "$model")" > "$(basename "$model").sha256" )
else
  echo "» 跳过模型包（SKIP_MODEL=1）"
fi

echo "✓ 完成"
echo "  核心包: $core  ($(du -h "$core" | cut -f1))"
[[ -f "$model" ]] && echo "  模型包: $model  ($(du -h "$model" | cut -f1))"
echo "  ※ 核心包不含 deb；装机前按飞书文档下载最新 deb 放入 packages/："
echo "    $DEB_DOC_URL"
