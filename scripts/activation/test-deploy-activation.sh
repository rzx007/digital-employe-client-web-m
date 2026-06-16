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

echo "----"; echo "PASS=$PASS FAIL=$FAIL"; [[ $FAIL -eq 0 ]]
