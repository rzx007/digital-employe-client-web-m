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
