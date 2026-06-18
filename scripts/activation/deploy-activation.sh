#!/usr/bin/env bash
# deploy.sh 激活阶段函数库。可被 deploy.sh source，也可独立验证。
# 设备码算法字节级复刻 activation_core.device.compute_local_device_code。

de_compute_device_code() {  # → 20 hex 大写（无分隔）
  python3 - <<'PY'
import hashlib, uuid
def read_machine_id():
    for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            with open(p, encoding="utf-8") as f:
                c = f.read().strip()
                if c: return c
        except OSError:
            continue
    return ""
mac = uuid.getnode()
raw = f"{mac:012x}|{read_machine_id()}"
print(hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20].upper())
PY
}

de_format_device_code() {  # 20 hex → XXXX-XXXX-XXXX-XXXX-XXXX
  echo "$1" | sed 's/.\{4\}/&-/g; s/-$//'
}

de_parse_license() {  # 入参=授权码 → 输出 "<device_in_code>\t<exp>"；非法则非零退出
  python3 - "$1" <<'PY'
import sys, json, base64
code = sys.argv[1].strip()
try:
    b64 = code.split(".", 1)[0]
    b64 += "=" * (-len(b64) % 4)
    p = json.loads(base64.urlsafe_b64decode(b64))
    print(f'{p["d"]}\t{p["exp"]}')
except Exception as exc:
    sys.stderr.write(f"parse_error: {exc}\n")
    sys.exit(1)
PY
}

de_now_iso() {  # UTC ISO，6 位微秒 + Z（与 Python isoformat 风格一致）
  date -u +%Y-%m-%dT%H:%M:%S.%6NZ
}

# 调用者真实家目录：sudo 下 $HOME=/root，必须回查 SUDO_USER，
# 否则 ${HOME}/BobanStaff/... / ${HOME}/.digital-employee/... 全部指错。
de_caller_home() {
  if [[ -n "${SUDO_USER:-}" ]] && [[ "${SUDO_USER}" != "root" ]]; then
    getent passwd "$SUDO_USER" | cut -d: -f6
  else
    echo "${HOME}"
  fi
}

# 数据目录默认 ~/.digital-employee/data，可用 DE_DATA_DIR 覆盖（测试用）。
de_data_dir() { echo "${DE_DATA_DIR:-$(de_caller_home)/.digital-employee/data}"; }

de_write_activation_json() {  # <device> <license> <expires_at>
  local dev="$1" lic="$2" exp="$3" dir now
  dir="$(de_data_dir)"; now="$(de_now_iso)"
  mkdir -p "$dir"
  python3 - "$dir/activation.json" "$dev" "$lic" "$exp" "$now" <<'PY'
import sys, json
path, dev, lic, exp, now = sys.argv[1:6]
rec = {"device_code": dev, "license_code": lic, "expires_at": exp,
       "activated_at": now, "last_seen_at": now}
with open(path, "w", encoding="utf-8") as f:
    json.dump(rec, f, ensure_ascii=False, indent=2)
PY
}

# 授权码文件候选（按序）。文件内抓第一段 base64URL.base64URL 即授权码。
# 主路径 license.code 与现场手册 (docs/field-deployment-manual.md) 对齐；
# activation.code 是历史命名，留作兼容。
DE_LICENSE_FILE_CANDIDATES=(
  "${INSTALLER_DIR:-}/license.code"
  "${INSTALLER_DIR:-}/activation.code"
  "$(de_caller_home)/BobanStaff/activation/license.code"
)

# 抓第一段长得像 base64URL.base64URL 的内容（payload+sig）。
# 这样能跳过 BOM / 注释 / 设备码行 / Markdown 包装，并自动剥掉行内空白和 \r。
de_extract_license_token() {  # <file> → 第一段授权码；无则非零
  awk 'match($0,/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/){
         print substr($0,RSTART,RLENGTH); found=1; exit
       }
       END{exit found?0:1}' "$1"
}

de_read_license_from_file() {  # [显式路径] → 第一段授权码；无则非零
  local f line
  if [[ -n "${1:-}" ]]; then
    [[ -f "$1" ]] || return 1
    line="$(de_extract_license_token "$1")" || return 1
    [[ -n "$line" ]] || return 1
    echo "$line"; return 0
  fi
  for f in "${DE_LICENSE_FILE_CANDIDATES[@]}"; do
    [[ -n "$f" && -f "$f" ]] || continue
    line="$(de_extract_license_token "$f")" || continue
    [[ -n "$line" ]] || continue
    echo "$line"; return 0
  done
  return 1
}

de_license_valid_for_device() {  # <license> <device> → 0=有效 1=拒绝（设备不符/过期/非法）
  local lic="$1" dev="$2" parsed code_dev exp
  parsed="$(de_parse_license "$lic")" || return 1
  code_dev="$(echo "$parsed" | cut -f1)"
  exp="$(echo "$parsed" | cut -f2)"
  [[ "${code_dev//-/}" == "${dev//-/}" ]] || return 1
  python3 - "$exp" <<'PY' || return 1
import sys, datetime
exp = sys.argv[1].replace("Z", "+00:00")
dt = datetime.datetime.fromisoformat(exp)
now = datetime.datetime.now(datetime.timezone.utc)
sys.exit(0 if now < dt else 1)
PY
  return 0
}

# 独立运行降级桩（deploy.sh 已定义则不覆盖）
type record >/dev/null 2>&1 || record() { echo "[record] $*"; }
type info   >/dev/null 2>&1 || info()   { echo "» $*"; }
type ok     >/dev/null 2>&1 || ok()     { echo "✓ $*"; }
type warn   >/dev/null 2>&1 || warn()   { echo "⚠ $*"; }
type say    >/dev/null 2>&1 || say()    { echo -e "$*"; }
: "${DE_USER:=$(id -un)}"

stage_activation() {
  info "数字员工激活"
  local dev disp dir json
  dev="$(de_compute_device_code)"; disp="$(de_format_device_code "$dev")"
  dir="$(de_data_dir)"; json="$dir/activation.json"

  say "  设备码（序列号）：${disp}"
  say "  请凭此码在飞书申请激活码。"

  # 当前激活态：cur_valid=1 表示已激活且设备匹配且未过期；cur_exp=当前到期
  local cur_valid="" cur_exp=""
  if [[ -f "$json" ]]; then
    local cur_dev cur_lic
    cur_dev="$(python3 -c "import json;print(json.load(open('$json')).get('device_code',''))" 2>/dev/null)"
    cur_lic="$(python3 -c "import json;print(json.load(open('$json')).get('license_code',''))" 2>/dev/null)"
    cur_exp="$(python3 -c "import json;print(json.load(open('$json')).get('expires_at',''))" 2>/dev/null)"
    if [[ "${cur_dev//-/}" == "${dev//-/}" ]] && de_license_valid_for_device "$cur_lic" "$dev" 2>/dev/null; then
      cur_valid=1
    fi
  fi

  # 取码：文件优先 → 终端粘贴回退（已有效激活时不打扰粘贴）
  local lic=""
  if lic="$(de_read_license_from_file)"; then
    info "已从文件读取授权码"
  elif [[ -z "$cur_valid" && -t 0 ]]; then
    say "  未发现授权码文件。粘入授权码后回车（留空跳过）："
    read -r lic
  fi

  # 无新授权码：已激活则跳过，否则提示等待
  if [[ -z "${lic// /}" ]]; then
    if [[ -n "$cur_valid" ]]; then
      ok "已激活（设备码 ${disp}，有效期至 ${cur_exp}）"; record activation OK "已激活"; return 0
    fi
    warn "未激活：无授权码来源（设备码 ${disp}；放入授权码文件或重跑粘贴）"
    record activation WARN "未激活：等待授权码" "凭设备码 ${disp} 去飞书换码，写入授权码文件后重跑 deploy.sh"
    return 0
  fi

  # 解析 + 设备/有效期校验
  local parsed
  if ! parsed="$(de_parse_license "$lic" 2>/dev/null)"; then
    warn "授权码格式错误（不是有效的授权码字符串），未激活"
    record activation WARN "授权码格式错误" "确认 license.code 内只放授权码主体（base64URL.签名）"
    return 0
  fi
  if ! de_license_valid_for_device "$lic" "$dev"; then
    warn "授权码无效（设备不符或已过期），未激活"
    record activation WARN "授权码无效（设备不符/过期）" "确认授权码对应设备码 ${disp} 且未过期"
    return 0
  fi
  local exp; exp="$(echo "$parsed" | cut -f2)"

  # 覆盖确认：仅当「当前已是有效激活」且「新码与当前不同」时询问
  if [[ -n "$cur_valid" ]]; then
    if [[ "$exp" == "$cur_exp" ]]; then
      ok "已激活（设备码 ${disp}，有效期至 ${cur_exp}）"; record activation OK "已激活"; return 0
    fi
    say "  当前已激活，有效期至 ${cur_exp}。"
    say "  新授权码有效期至 ${exp}。"
    if [[ -t 0 ]]; then
      local ans=""
      read -r -p "  是否用新授权码覆盖当前激活？[y/N] " ans
      if [[ ! "$ans" =~ ^[Yy]$ ]]; then
        ok "已保持当前激活（有效期至 ${cur_exp}），未覆盖"
        record activation OK "保持当前激活（用户未确认覆盖）"; return 0
      fi
    else
      warn "检测到不同授权码，但非交互环境未确认覆盖；保持当前激活（有效期至 ${cur_exp}）不变"
      say "  如需覆盖：删除 ${json} 后重跑，或在交互终端运行 deploy.sh。"
      record activation OK "保持当前激活（非交互未覆盖）"; return 0
    fi
  fi

  de_write_activation_json "$dev" "$lic" "$exp"
  chown "${DE_USER}:${DE_USER}" "$json" 2>/dev/null || true
  ok "已激活，有效期至 ${exp}"
  record activation OK "已激活，有效期至 ${exp}"
}
