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

# 文件取码：第一行非空即码
LICFILE="$(mktemp)"; printf '%s\n' "$GOLDEN_LIC" > "$LICFILE"
check "read license from file" "$GOLDEN_LIC" "$(de_read_license_from_file "$LICFILE")"

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
