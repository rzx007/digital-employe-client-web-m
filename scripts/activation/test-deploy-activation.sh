#!/usr/bin/env bash
# 激活函数库验证。多数用例可本地跑；设备码对拍需在 220 真机跑。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/deploy-activation.sh"
PASS=0; FAIL=0
check() { # check <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1"; echo "  expected: $2"; echo "  actual:   $3"; FAIL=$((FAIL+1)); fi
}

# 用例：设备码必须等于本机金标准（仅在 220 真机有意义）
DEV="$(de_compute_device_code)"
check "device_code matches golden" "3E5677F8E9179E207A30" "$DEV"

GOLDEN_LIC="eyJkIjoiM0U1Njc3RjhFOTE3OUUyMDdBMzAiLCJleHAiOiIyMDI3LTA2LTA2VDA5OjQ2OjIzLjAyNzc1NFoiLCJpYXQiOiIyMDI2LTA2LTA2VDA5OjQ2OjIzLjA0MjA2MloiLCJ2IjoxfQ.2lFrRD6LzNZZYOqWEDmUxjOf0LhgiDGwa3uU4qp4Y17KAoNfKvxaqdpWxDLqrTDY3JSmGjgM7gRBR5Vmht_MBw"
PARSED="$(de_parse_license "$GOLDEN_LIC")"
check "parse device_code" "3E5677F8E9179E207A30" "$(echo "$PARSED" | cut -f1)"
check "parse expires"     "2027-06-06T09:46:23.027754Z" "$(echo "$PARSED" | cut -f2)"

TMPJSON="$(mktemp -d)/activation.json"
DE_DATA_DIR="$(dirname "$TMPJSON")" \
  de_write_activation_json "3E5677F8E9179E207A30" "$GOLDEN_LIC" "2027-06-06T09:46:23.027754Z"
WROTE_DEV="$(python3 -c "import json;print(json.load(open('$TMPJSON'))['device_code'])")"
WROTE_EXP="$(python3 -c "import json;print(json.load(open('$TMPJSON'))['expires_at'])")"
check "written device_code" "3E5677F8E9179E207A30" "$WROTE_DEV"
check "written expires_at"  "2027-06-06T09:46:23.027754Z" "$WROTE_EXP"
HAS_ACT="$(python3 -c "import json;d=json.load(open('$TMPJSON'));print('yes' if d.get('activated_at') and d.get('last_seen_at') else 'no')")"
check "has activated/last_seen" "yes" "$HAS_ACT"

# 调用者家目录解算：sudo 下必须回查 SUDO_USER 而不是用 $HOME=/root
# 模拟 sudo 环境：SUDO_USER 设为当前用户，HOME 强制改成 /root
SELF="$(id -un)"; SELF_HOME="$(getent passwd "$SELF" | cut -d: -f6)"
CALLER_UNDER_SUDO="$(SUDO_USER=$SELF HOME=/root bash -c "source $HERE/deploy-activation.sh; de_caller_home")"
check "caller_home: under sudo resolves SUDO_USER" "$SELF_HOME" "$CALLER_UNDER_SUDO"
CALLER_NO_SUDO="$(env -u SUDO_USER HOME=/tmp/some-home bash -c "source $HERE/deploy-activation.sh; de_caller_home")"
check "caller_home: no sudo falls back to HOME" "/tmp/some-home" "$CALLER_NO_SUDO"
# 候选 3 在 sudo 下应该指向真用户的家，不是 /root
CAND3="$(SUDO_USER=$SELF HOME=/root bash -c "source $HERE/deploy-activation.sh; echo \"\${DE_LICENSE_FILE_CANDIDATES[2]}\"")"
check "candidate-3 honors SUDO_USER home" "$SELF_HOME/BobanStaff/activation/license.code" "$CAND3"

# 文件取码：纯一行授权码（原行为保留）
LICFILE="$(mktemp)"; printf '%s\n' "$GOLDEN_LIC" > "$LICFILE"
check "read license: bare line" "$GOLDEN_LIC" "$(de_read_license_from_file "$LICFILE")"

# 文件取码：首行设备码 + 次行授权码（飞书审批回执的实际格式，本次回归）
LICFILE2="$(mktemp)"; printf '%s\n%s\n' "3E56-77F8-E917-9E20-7A30" "$GOLDEN_LIC" > "$LICFILE2"
check "read license: skips device-code line" "$GOLDEN_LIC" "$(de_read_license_from_file "$LICFILE2")"

# 文件取码：Markdown 包装 + 注释 + 空行
LICFILE3="$(mktemp)"
{ echo "# 授权码"; echo ""; echo "设备: 3E56-77F8-E917-9E20-7A30"; echo "license: $GOLDEN_LIC"; } > "$LICFILE3"
check "read license: markdown noise" "$GOLDEN_LIC" "$(de_read_license_from_file "$LICFILE3")"

# 文件取码：UTF-8 BOM + CRLF
LICFILE4="$(mktemp)"
printf '\xef\xbb\xbf%s\r\n' "$GOLDEN_LIC" > "$LICFILE4"
check "read license: BOM+CRLF tolerated" "$GOLDEN_LIC" "$(de_read_license_from_file "$LICFILE4")"

# 文件取码：纯设备码（没有授权码）→ 必须报「没找到」而不是吐出设备码
LICFILE5="$(mktemp)"; printf '%s\n' "3E56-77F8-E917-9E20-7A30" > "$LICFILE5"
de_read_license_from_file "$LICFILE5" >/dev/null 2>&1
check "read license: device-only file rejected" "1" "$?"

# 校验：设备匹配 + 未过期 → 0
de_license_valid_for_device "$GOLDEN_LIC" "3E5677F8E9179E207A30" 2>/dev/null
check "valid license accepted" "0" "$?"

# 校验：设备不匹配 → 非 0
de_license_valid_for_device "$GOLDEN_LIC" "FFFFFFFFFFFFFFFFFFFF" 2>/dev/null
check "device mismatch rejected" "1" "$?"

# 校验：过期 payload → 非 0（构造一个 exp 在过去的码，签名无关，校验只看 d/exp）
EXPIRED="$(python3 -c "import base64,json;p={'d':'3E5677F8E9179E207A30','exp':'2000-01-01T00:00:00Z','v':1};b=base64.urlsafe_b64encode(json.dumps(p,separators=(',',':')).encode()).rstrip(b'=').decode();print(b+'.x')")"
de_license_valid_for_device "$EXPIRED" "3E5677F8E9179E207A30" 2>/dev/null
check "expired license rejected" "1" "$?"

echo "----"; echo "PASS=$PASS FAIL=$FAIL"; [[ $FAIL -eq 0 ]]
