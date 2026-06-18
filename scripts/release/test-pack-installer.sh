#!/usr/bin/env bash
# 用 mock Installer 目录验证 pack-installer.sh 拆包正确。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PACK="$HERE/pack-installer.sh"
PASS=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (exp=$2 act=$3)"; FAIL=$((FAIL+1)); fi; }

WORK="$(mktemp -d)"; INST="$WORK/BobanStaff-Installer"; OUT="$WORK/dist"
mkdir -p "$INST/packages" "$INST/images" "$INST/runtime" "$INST/ime"
echo "#!/bin/bash" > "$INST/deploy.sh"
# 混合两种命名：旧 DigitalEmployee-Offline-* 与 新 BobanStaff-*；最高版是新命名 0.1.16
head -c 100 /dev/zero > "$INST/packages/DigitalEmployee-Offline-Linux-arm64-0.1.3.deb"
head -c 100 /dev/zero > "$INST/packages/DigitalEmployee-Offline-Linux-arm64-0.1.0.debbak2"
head -c 100 /dev/zero > "$INST/packages/hanhai-cli-linux-arm64.tar.gz"
head -c 100 /dev/zero > "$INST/packages/DigitalEmployee-Offline-Linux-arm64-0.1.1.deb"
head -c 100 /dev/zero > "$INST/packages/BobanStaff-Linux-arm64-0.1.16.deb"
head -c 100 /dev/zero > "$INST/ime/x.deb"
echo "compose" > "$INST/runtime/docker-compose.yml"
head -c 100 /dev/zero > "$INST/runtime/Hanhai-Q4.gguf"
head -c 100 /dev/zero > "$INST/runtime/mmproj-F16.gguf"
head -c 100 /dev/zero > "$INST/images/llama.tar"

bash "$PACK" "$INST" "$OUT" >/dev/null 2>&1

CORE="$OUT/BobanStaff-Core.zip"
MODEL="$OUT/BobanStaff-Model.zip"
check "core zip exists (无版本名)" "yes" "$([[ -f "$CORE" ]] && echo yes || echo no)"
check "model zip exists" "yes" "$([[ -f "$MODEL" ]] && echo yes || echo no)"

corelist="$(unzip -Z1 "$CORE" 2>/dev/null)"
check "core 含 deploy.sh"   "yes" "$(echo "$corelist" | grep -qE '(^|/)deploy.sh$' && echo yes || echo no)"
check "core 不含 packages deb(改按文档下载)" "no" "$(echo "$corelist" | grep -qE 'packages/.*\.deb$' && echo yes || echo no)"
check "core 含 deb 下载说明" "yes" "$(echo "$corelist" | grep -q '下载说明' && echo yes || echo no)"
check "core 含 cli"         "yes" "$(echo "$corelist" | grep -q 'hanhai-cli' && echo yes || echo no)"
check "core 含 compose"     "yes" "$(echo "$corelist" | grep -q 'docker-compose.yml$' && echo yes || echo no)"
check "core 不含 gguf"      "no"  "$(echo "$corelist" | grep -q '.gguf$' && echo yes || echo no)"
check "core 不含 images tar" "no" "$(echo "$corelist" | grep -qE 'images/.*tar$' && echo yes || echo no)"
check "core 排除 debbak"    "no"  "$(echo "$corelist" | grep -q 'debbak' && echo yes || echo no)"

modellist="$(unzip -Z1 "$MODEL" 2>/dev/null)"
check "model 含 gguf"       "yes" "$(echo "$modellist" | grep -q 'Hanhai-Q4.gguf$' && echo yes || echo no)"
check "model 含 images tar" "yes" "$(echo "$modellist" | grep -qE 'images/.*tar$' && echo yes || echo no)"
check "model 不含 deb"      "no"  "$(echo "$modellist" | grep -q '.deb$' && echo yes || echo no)"
check "core SHA256SUMS"     "yes" "$([[ -f "$OUT/BobanStaff-Core.zip.sha256" ]] && echo yes || echo no)"

# 打包不得污染安装器目录：下载说明用后即删
check "安装器目录不残留说明文件" "no" "$([[ -e "$INST/packages/数字员工deb-下载说明.txt" ]] && echo yes || echo no)"

rm -rf "$WORK"
echo "----"; echo "PASS=$PASS FAIL=$FAIL"; [[ $FAIL -eq 0 ]]
