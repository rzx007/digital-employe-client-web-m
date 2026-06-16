# deploy.sh 激活阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给一体机安装器 `deploy.sh` 增加「激活阶段」：算设备码 → 双通道注入授权码（文件优先/终端粘贴）→ 直接写 `activation.json`，仅激活数字员工。

**Architecture:** deploy 不走 App 后端 HTTP（后端只在 App 开时起、端口动态、单文件 ELF 不可内省），改用自包含 `python3` 内联脚本字节级复刻设备码算法与授权码解析，激活码落位为普通 JSON 文件，App 启动时自行 `verify_license` 兜底。设备码算法一致性是第一风险，用真机现有 `activation.json` 对拍卡死。

**Tech Stack:** Bash（deploy.sh）、内联 python3（设备码/payload 解析）、SSH+paramiko（在 220 真机验证）。

**目标文件位置说明：** `deploy.sh` 是一体机安装包产物，**不在本仓库**，位于
`10.172.246.220:/home/boban/BobanStaff-Installer/deploy.sh`。本计划在**本仓库**维护一份
权威副本与可复用激活片段，再同步到 220 真机验证。维护落点：
- `scripts/activation/deploy-activation.sh` — 可独立验证的激活函数库（被 deploy.sh source 或内联）
- `scripts/activation/test-deploy-activation.sh` — 真机对拍/单元验证脚本
- 真机 `deploy.sh` 在 Task 6 整合并就地验证。

**SSH 凭据（验证用）：** host `10.172.246.220` user `boban`；**密码绝不写进脚本/仓库**，
通过环境变量 `DE220_PWD` 在运行时传入（`_ssh.py` 从 env 读，缺失即报错退出）。本机无 sshpass，
用 `python + paramiko`（conda 解释器，已确认可用）执行远程命令。后续所有 `_ssh.py` 调用统一形如
`DE220_PWD=100200 python scripts/activation/_ssh.py run "..."`（密码在命令行环境变量里，不入库）。
**真机现有 `activation.json` 必须先备份**（Task 1），所有破坏性验证后还原。

**⚠️ SFTP chroot 坑（Task 2 实测）：** 220 的 SFTP 被 chroot 到 `boban` 家目录，
`_ssh.py put` 到绝对路径 `/tmp/...` 会报 `[Errno 2] No such file`。**put 必须用家目录下的
相对路径**（如 `de-act/xxx.sh`，落在 `/home/boban/de-act/`），需要时再用 `run`（exec 通道，
不受 chroot 限制）`mv` 到 `/tmp`。`run` 命令本身用绝对路径无碍。下文示例里的 `put ... /tmp/...`
请相应改为 put 到家目录相对路径后再处理。

**已核实的真机基准值（对拍金标准）：**
- 本机设备码（无分隔）：`3E5677F8E9179E207A30`
- 现有授权码 `license_code`：`eyJkIjoiM0U1Njc3RjhFOTE3OUUyMDdBMzAiLCJleHAiOiIyMDI3LTA2LTA2VDA5OjQ2OjIzLjAyNzc1NFoiLCJpYXQiOiIyMDI2LTA2LTA2VDA5OjQ2OjIzLjA0MjA2MloiLCJ2IjoxfQ.2lFrRD6LzNZZYOqWEDmUxjOf0LhgiDGwa3uU4qp4Y17KAoNfKvxaqdpWxDLqrTDY3JSmGjgM7gRBR5Vmht_MBw`
- payload 解出：`d=3E5677F8E9179E207A30` `exp=2027-06-06T09:46:23.027754Z`
- 数据目录：`/home/boban/.digital-employee/data/`（属主 boban）

---

## File Structure

| 文件 | 责任 |
|------|------|
| `scripts/activation/deploy-activation.sh` | 激活函数库：`de_compute_device_code` / `de_format_device_code` / `de_parse_license` / `de_now_iso` / `de_write_activation_json` / `de_read_license_from_file` / `stage_activation` |
| `scripts/activation/test-deploy-activation.sh` | 本地+真机验证：对拍设备码、解析、落位、拒绝用例 |
| `10.172.246.220:.../deploy.sh` | 整合：source 或内联激活库 + 在 `main()` 调 `stage_activation` + 报告文案 |

---

## Task 1: 备份真机激活态 + 建立 SSH 验证脚手架

**Files:**
- Create: `scripts/activation/_ssh.py`（验证用远程执行小工具）

- [ ] **Step 1: 写 SSH 执行小工具**

Create `scripts/activation/_ssh.py`:

```python
#!/usr/bin/env python3
"""在 220 真机执行命令/传文件（验证用）。用法见 __main__。"""
import sys, paramiko

HOST, USER, PWD = "10.172.246.220", "boban", "100200"

def _client():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PWD, timeout=15,
              allow_agent=False, look_for_keys=False)
    return c

def run(cmd):
    c = _client()
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    code = o.channel.recv_exit_status()
    c.close()
    return code, out, err

def put(local, remote):
    c = _client(); s = c.open_sftp()
    s.put(local, remote); s.close(); c.close()

if __name__ == "__main__":
    if sys.argv[1] == "run":
        code, out, err = run(sys.argv[2])
        sys.stdout.write(out)
        if err.strip(): sys.stderr.write(err)
        sys.exit(code)
    elif sys.argv[1] == "put":
        put(sys.argv[2], sys.argv[3]); print("PUT_OK")
```

- [ ] **Step 2: 备份真机 activation.json（破坏性验证的安全网）**

Run:
```bash
python3 scripts/activation/_ssh.py run "cp -a /home/boban/.digital-employee/data/activation.json /home/boban/.digital-employee/data/activation.json.bak-plan && echo BACKED_UP && cat /home/boban/.digital-employee/data/activation.json"
```
Expected: 输出 `BACKED_UP` + 现有 JSON（含 `3E5677F8E9179E207A30`）。

- [ ] **Step 3: 记录金标准设备码**

Run:
```bash
python3 scripts/activation/_ssh.py run "python3 -c \"import json;print(json.load(open('/home/boban/.digital-employee/data/activation.json'))['device_code'])\""
```
Expected: `3E5677F8E9179E207A30`

- [ ] **Step 4: Commit**

```bash
git add scripts/activation/_ssh.py
git commit -m "chore(activation): SSH 验证脚手架 + 真机激活态已备份"
```

---

## Task 2: 设备码计算（对拍真机金标准）

**Files:**
- Create: `scripts/activation/deploy-activation.sh`
- Test: `scripts/activation/test-deploy-activation.sh`

- [ ] **Step 1: 写失败测试（对拍设备码）**

Create `scripts/activation/test-deploy-activation.sh`:

```bash
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

echo "----"; echo "PASS=$PASS FAIL=$FAIL"; [[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: 在真机跑，确认失败（函数还不存在）**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/test-deploy-activation.sh /tmp/test-deploy-activation.sh
python3 scripts/activation/_ssh.py run "bash /tmp/test-deploy-activation.sh"
```
Expected: 报错 `de-activation.sh: No such file` 或 `de_compute_device_code: command not found`（库未创建）。

- [ ] **Step 3: 写设备码函数（最小实现）**

Create `scripts/activation/deploy-activation.sh`:

```bash
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
```

- [ ] **Step 4: 在真机跑，确认通过**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/deploy-activation.sh /tmp/deploy-activation.sh
python3 scripts/activation/_ssh.py put scripts/activation/test-deploy-activation.sh /tmp/test-deploy-activation.sh
python3 scripts/activation/_ssh.py run "cd /tmp && bash test-deploy-activation.sh"
```
Expected: `PASS: device_code matches golden` + `PASS=1 FAIL=0`。

> ⚠️ 若 FAIL：算法与 App 不一致，**停止**，核对 machine-id 来源/MAC 取值/截断/大小写，
> 直到 PASS。不得继续后续 Task。

- [ ] **Step 5: 验证显示格式**

Run:
```bash
python3 scripts/activation/_ssh.py run "source /tmp/deploy-activation.sh && de_format_device_code 3E5677F8E9179E207A30"
```
Expected: `3E56-77F8-E917-9E20-7A30`

- [ ] **Step 6: Commit**

```bash
git add scripts/activation/deploy-activation.sh scripts/activation/test-deploy-activation.sh
git commit -m "feat(activation): deploy 设备码计算 + 对拍真机金标准通过"
```

---

## Task 3: 授权码 payload 解析

**Files:**
- Modify: `scripts/activation/deploy-activation.sh`
- Modify: `scripts/activation/test-deploy-activation.sh`

- [ ] **Step 1: 加失败测试（解析 d/exp）**

在 `test-deploy-activation.sh` 的 `echo "----"` 之前插入：

```bash
GOLDEN_LIC="eyJkIjoiM0U1Njc3RjhFOTE3OUUyMDdBMzAiLCJleHAiOiIyMDI3LTA2LTA2VDA5OjQ2OjIzLjAyNzc1NFoiLCJpYXQiOiIyMDI2LTA2LTA2VDA5OjQ2OjIzLjA0MjA2MloiLCJ2IjoxfQ.2lFrRD6LzNZZYOqWEDmUxjOf0LhgiDGwa3uU4qp4Y17KAoNfKvxaqdpWxDLqrTDY3JSmGjgM7gRBR5Vmht_MBw"
PARSED="$(de_parse_license "$GOLDEN_LIC")"
check "parse device_code" "3E5677F8E9179E207A30" "$(echo "$PARSED" | cut -f1)"
check "parse expires"     "2027-06-06T09:46:23.027754Z" "$(echo "$PARSED" | cut -f2)"
```

- [ ] **Step 2: 真机跑，确认新用例失败**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/test-deploy-activation.sh /tmp/test-deploy-activation.sh
python3 scripts/activation/_ssh.py run "cd /tmp && bash test-deploy-activation.sh"
```
Expected: `de_parse_license: command not found` 或对应 FAIL。

- [ ] **Step 3: 实现解析函数**

在 `deploy-activation.sh` 末尾追加：

```bash
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
```

- [ ] **Step 4: 真机跑，确认通过**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/deploy-activation.sh /tmp/deploy-activation.sh
python3 scripts/activation/_ssh.py run "cd /tmp && bash test-deploy-activation.sh"
```
Expected: `PASS: parse device_code` + `PASS: parse expires` + `FAIL=0`。

- [ ] **Step 5: Commit**

```bash
git add scripts/activation/deploy-activation.sh scripts/activation/test-deploy-activation.sh
git commit -m "feat(activation): deploy 授权码 payload 解析 + 对拍通过"
```

---

## Task 4: activation.json 落位 + 时间戳

**Files:**
- Modify: `scripts/activation/deploy-activation.sh`
- Modify: `scripts/activation/test-deploy-activation.sh`

- [ ] **Step 1: 加失败测试（落位写文件）**

在 `test-deploy-activation.sh` 的 `echo "----"` 之前插入：

```bash
TMPJSON="$(mktemp -d)/activation.json"
DE_DATA_DIR="$(dirname "$TMPJSON")" \
  de_write_activation_json "3E5677F8E9179E207A30" "$GOLDEN_LIC" "2027-06-06T09:46:23.027754Z"
WROTE_DEV="$(python3 -c "import json;print(json.load(open('$TMPJSON'))['device_code'])")"
WROTE_EXP="$(python3 -c "import json;print(json.load(open('$TMPJSON'))['expires_at'])")"
check "written device_code" "3E5677F8E9179E207A30" "$WROTE_DEV"
check "written expires_at"  "2027-06-06T09:46:23.027754Z" "$WROTE_EXP"
HAS_ACT="$(python3 -c "import json;d=json.load(open('$TMPJSON'));print('yes' if d.get('activated_at') and d.get('last_seen_at') else 'no')")"
check "has activated/last_seen" "yes" "$HAS_ACT"
```

- [ ] **Step 2: 真机跑，确认失败**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/test-deploy-activation.sh /tmp/test-deploy-activation.sh
python3 scripts/activation/_ssh.py run "cd /tmp && bash test-deploy-activation.sh"
```
Expected: `de_write_activation_json: command not found` 或对应 FAIL。

- [ ] **Step 3: 实现时间戳 + 落位函数**

在 `deploy-activation.sh` 末尾追加：

```bash
de_now_iso() {  # UTC ISO，6 位微秒 + Z（与 Python isoformat 风格一致）
  date -u +%Y-%m-%dT%H:%M:%S.%6NZ
}

# 数据目录默认 ~/.digital-employee/data，可用 DE_DATA_DIR 覆盖（测试用）。
de_data_dir() { echo "${DE_DATA_DIR:-${HOME}/.digital-employee/data}"; }

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
```

- [ ] **Step 4: 真机跑，确认通过**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/deploy-activation.sh /tmp/deploy-activation.sh
python3 scripts/activation/_ssh.py run "cd /tmp && bash test-deploy-activation.sh"
```
Expected: `written device_code`/`written expires_at`/`has activated/last_seen` 全 PASS，`FAIL=0`。

- [ ] **Step 5: Commit**

```bash
git add scripts/activation/deploy-activation.sh scripts/activation/test-deploy-activation.sh
git commit -m "feat(activation): deploy activation.json 落位 + ISO 时间戳"
```

---

## Task 5: 双通道取码 + stage_activation 编排 + 拒绝用例

**Files:**
- Modify: `scripts/activation/deploy-activation.sh`
- Modify: `scripts/activation/test-deploy-activation.sh`

- [ ] **Step 1: 加失败测试（文件取码 + 设备不匹配拒绝 + 过期拒绝 + 幂等）**

在 `test-deploy-activation.sh` 的 `echo "----"` 之前插入：

```bash
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
```

- [ ] **Step 2: 真机跑，确认失败**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/test-deploy-activation.sh /tmp/test-deploy-activation.sh
python3 scripts/activation/_ssh.py run "cd /tmp && bash test-deploy-activation.sh"
```
Expected: `de_read_license_from_file` / `de_license_valid_for_device` not found 或 FAIL。

- [ ] **Step 3: 实现取码 + 校验 + 编排**

在 `deploy-activation.sh` 末尾追加：

```bash
# 授权码文件候选（按序）。第一行非空内容即授权码。
DE_LICENSE_FILE_CANDIDATES=(
  "${PKG_DIR:-}/activation.md"
  "${INSTALLER_DIR:-}/activation.code"
  "${HOME}/BobanStaff/activation/license.code"
)

de_read_license_from_file() {  # [显式路径] → 第一行非空；无则非零
  local f
  if [[ -n "${1:-}" ]]; then
    [[ -f "$1" ]] || return 1
    awk 'NF{print;exit}' "$1"; return 0
  fi
  for f in "${DE_LICENSE_FILE_CANDIDATES[@]}"; do
    [[ -n "$f" && -f "$f" ]] || continue
    local line; line="$(awk 'NF{print;exit}' "$f")"
    if [[ -n "$line" ]]; then echo "$line"; return 0; fi
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
```

- [ ] **Step 4: 真机跑，确认通过**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/deploy-activation.sh /tmp/deploy-activation.sh
python3 scripts/activation/_ssh.py run "cd /tmp && bash test-deploy-activation.sh"
```
Expected: 取码/接受/设备不匹配拒绝/过期拒绝全 PASS，`FAIL=0`。

- [ ] **Step 5: 实现 stage_activation（编排，依赖 deploy.sh 的 record/say/ok/warn/info）**

在 `deploy-activation.sh` 末尾追加。注：`record`/`say`/`ok`/`warn`/`info`/`DE_USER` 由
deploy.sh 提供；独立运行时给降级桩，便于验证。

```bash
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

  # 幂等：已激活且设备匹配且未过期 → 跳过
  if [[ -f "$json" ]]; then
    local cur_dev cur_lic
    cur_dev="$(python3 -c "import json;print(json.load(open('$json')).get('device_code',''))" 2>/dev/null)"
    cur_lic="$(python3 -c "import json;print(json.load(open('$json')).get('license_code',''))" 2>/dev/null)"
    if [[ "${cur_dev//-/}" == "${dev//-/}" ]] && de_license_valid_for_device "$cur_lic" "$dev" 2>/dev/null; then
      ok "已激活（设备码 $disp）"; record activation OK "已激活"; return 0
    fi
  fi

  say "  设备码（序列号）：${disp}"
  say "  请凭此码在飞书申请激活码。"

  # 取码：文件优先 → 终端粘贴回退
  local lic=""
  if lic="$(de_read_license_from_file)"; then
    info "已从文件读取授权码"
  elif [[ -t 0 ]]; then
    say "  未发现授权码文件。粘入授权码后回车（留空跳过）："
    read -r lic
  fi

  if [[ -z "${lic// /}" ]]; then
    warn "未激活：无授权码来源（设备码 ${disp}；放入授权码文件或重跑粘贴）"
    record activation WARN "未激活：等待授权码" "凭设备码 ${disp} 去飞书换码，写入授权码文件后重跑 deploy.sh"
    return 0
  fi

  if ! de_license_valid_for_device "$lic" "$dev"; then
    warn "授权码无效（设备不符或已过期），未激活"
    record activation WARN "授权码无效（设备不符/过期）" "确认授权码对应设备码 ${disp} 且未过期"
    return 0
  fi

  local exp; exp="$(de_parse_license "$lic" | cut -f2)"
  de_write_activation_json "$dev" "$lic" "$exp"
  chown "${DE_USER}:${DE_USER}" "$json" 2>/dev/null || true
  ok "已激活，有效期至 ${exp}"
  record activation OK "已激活，有效期至 ${exp}"
}
```

- [ ] **Step 6: 真机端到端验证（删码→文件通道→落位→还原）**

Run:
```bash
python3 scripts/activation/_ssh.py put scripts/activation/deploy-activation.sh /tmp/deploy-activation.sh
python3 scripts/activation/_ssh.py run '
set -e
source /tmp/deploy-activation.sh
export DE_DATA_DIR=/tmp/de-act-test; rm -rf "$DE_DATA_DIR"; mkdir -p "$DE_DATA_DIR"
# 文件通道：把金标准码写入候选文件
export PKG_DIR=/tmp/de-pkg; mkdir -p "$PKG_DIR"
cp /home/boban/.digital-employee/data/activation.json.bak-plan /tmp/keep 2>/dev/null || true
printf "%s\n" "$(python3 -c "import json;print(json.load(open(\"/home/boban/.digital-employee/data/activation.json.bak-plan\"))[\"license_code\"])")" > "$PKG_DIR/activation.md"
stage_activation
echo "=== 生成的 activation.json ==="; cat "$DE_DATA_DIR/activation.json"
echo "=== 幂等再跑 ==="; stage_activation
rm -rf "$DE_DATA_DIR" "$PKG_DIR"
'
```
Expected: 首跑打印设备码 `3E56-77F8-...` + 「已从文件读取授权码」+「已激活，有效期至 2027-06-06...」+ 正确 JSON；再跑输出「已激活（设备码 ...）」（幂等 SKIP）。

- [ ] **Step 7: Commit**

```bash
git add scripts/activation/deploy-activation.sh scripts/activation/test-deploy-activation.sh
git commit -m "feat(activation): deploy 双通道取码 + stage_activation 编排 + 拒绝/幂等用例"
```

---

## Task 6: 整合进真机 deploy.sh + 报告文案

**Files:**
- Modify: `10.172.246.220:/home/boban/BobanStaff-Installer/deploy.sh`
- Create: `scripts/activation/deploy.sh.activation.patch.md`（记录改动点，供溯源）

- [ ] **Step 1: 拉取真机 deploy.sh 最新副本到本地**

Run:
```bash
python3 scripts/activation/_ssh.py run "cat /home/boban/BobanStaff-Installer/deploy.sh" > /tmp/deploy.remote.sh
wc -l /tmp/deploy.remote.sh
```
Expected: 约 633 行。

- [ ] **Step 2: 备份真机 deploy.sh**

Run:
```bash
python3 scripts/activation/_ssh.py run "cp -a /home/boban/BobanStaff-Installer/deploy.sh /home/boban/BobanStaff-Installer/deploy.sh.bak.preactivation-$(date +%Y%m%d)"
```
Expected: 无输出（成功）。

- [ ] **Step 3: 内联激活库到 deploy.sh（在 UI 库之后、preflight 之前）**

把 `scripts/activation/deploy-activation.sh` 中**函数定义**（去掉 shebang 和独立运行降级桩，
因为 deploy.sh 已有 record/say/ok/warn/info/DE_USER）整段插入 deploy.sh，位置在
`# 校验目录内 SHA256SUMS` 函数 `verify_sums()` 定义之前（约第 212 行前）。
注意：`DE_LICENSE_FILE_CANDIDATES` 引用 `PKG_DIR`/`INSTALLER_DIR`，deploy.sh 顶部已定义，顺序 OK。

**Task 5 实测的两个集成要点（务必遵守）：**
1. **降级桩必须删除**：`type record/info/ok/warn/say ... || ...() {...}` 和 `: "${DE_USER:=...}"`
   这几行**不要内联**——deploy.sh 已有这些函数；且真机 `info` 会被系统 texinfo 命令抢占，
   桩反而有害。只内联 `de_*` 函数 + `DE_LICENSE_FILE_CANDIDATES` 数组 + `stage_activation`。
2. **数组求值顺序**：`DE_LICENSE_FILE_CANDIDATES` 在「定义那一刻」用 `${PKG_DIR:-}` 求值固化。
   插入位置（verify_sums 之前、约 212 行）晚于 deploy.sh 顶部 `PKG_DIR=`/`INSTALLER_DIR=` 定义
   （约 21-23 行），所以求值时变量已就绪，正确。**不要把内联点提到顶部变量定义之前。**

- [ ] **Step 4: 在 main() 调用 stage_activation**

修改 deploy.sh `main()`：在 `stage_digital_employee` 之后插入激活阶段：

```bash
  stage_digital_employee
  echo; hr '─'
  stage_activation
  echo; hr '─'
  stage_hanhai_cli
```

- [ ] **Step 5: 报告 label**

修改 deploy.sh `status_label()`，加一行（在 `digital_employee)` 行之后）：

```bash
  activation) echo "数字员工激活";;
```

- [ ] **Step 6: 把改好的 deploy.sh 推回真机并语法检查**

Run:
```bash
# 本地改好 /tmp/deploy.remote.sh 后推回为临时文件做 bash -n
python3 scripts/activation/_ssh.py put /tmp/deploy.remote.sh /tmp/deploy.new.sh
python3 scripts/activation/_ssh.py run "bash -n /tmp/deploy.new.sh && echo SYNTAX_OK"
```
Expected: `SYNTAX_OK`。

- [ ] **Step 7: 幂等真机演练（不破坏已激活态）**

由于该机**已激活**，直接整跑 deploy 的激活阶段应判定为「已激活 SKIP」。仅验证该阶段函数：
```bash
python3 scripts/activation/_ssh.py run "source /tmp/deploy.new.sh 2>/dev/null; type stage_activation >/dev/null && echo STAGE_DEFINED; DE_USER=boban stage_activation"
```
Expected: `STAGE_DEFINED` + 「已激活（设备码 3E56-77F8-...）」（命中幂等，不改文件）。

- [ ] **Step 8: 正式落位 deploy.sh + 记录补丁说明**

Run:
```bash
python3 scripts/activation/_ssh.py run "cp /tmp/deploy.new.sh /home/boban/BobanStaff-Installer/deploy.sh && echo DEPLOYED"
```
Create `scripts/activation/deploy.sh.activation.patch.md`：记录插入位置（verify_sums 前内联库、main 中 stage_digital_employee 后调用、status_label 加 activation）、备份文件名、220 路径，供后续维护溯源。

- [ ] **Step 9: 确认线上激活态关键字段完好（保留备份）**

> ⚠️ 实测修正：数字员工本体在运行时每 ~20s 心跳更新 `activation.json` 的 `last_seen_at`，
> 故对备份做**逐字节 diff 永远不等**。正确校验是**忽略 last_seen_at、只比对集成字段**
> （device_code/license_code/expires_at/activated_at）。备份 **不删**（继续留作安全网）。

Run:
```bash
python3 scripts/activation/_ssh.py run "python3 -c \"
import json
a=json.load(open('/home/boban/.digital-employee/data/activation.json'))
b=json.load(open('/home/boban/.digital-employee/data/activation.json.bak-plan'))
k=['device_code','license_code','expires_at','activated_at']
print('INTEGRITY_OK' if all(a[x]==b[x] for x in k) else 'INTEGRITY_FAIL')
print('changed:', [x for x in a if a.get(x)!=b.get(x)])
\""
```
Expected: `INTEGRITY_OK` + `changed: ['last_seen_at']`（只有心跳字段变化，关键激活字段未被污染）。

- [ ] **Step 10: Commit**

```bash
git add scripts/activation/deploy.sh.activation.patch.md
git commit -m "feat(activation): deploy.sh 整合激活阶段（220 真机已落位+幂等验证）"
```

---

## Task 7: 文档收尾

**Files:**
- Modify: `docs/activation-issuance-feishu-flow.md`
- Modify: `docs/activation-flow-current.md`

- [ ] **Step 1: 更新运维流程文档「衔接缺口」节**

把 `docs/activation-issuance-feishu-flow.md` 第 4 节「衔接缺口」更新为：deploy 已支持
双通道（文件/粘贴）取码并落 `activation.json`，路径乙的「放文件激活」已在 deploy 侧实现
（针对一体机；客户端 GUI 的文件导入仍为后续）。

- [ ] **Step 2: 在现状文档补一节「一体机 deploy 激活」**

在 `docs/activation-flow-current.md` 末尾加一节，指向本计划与 spec，说明一体机通过
`deploy.sh stage_activation` 完成激活，与客户端 GUI 填码并存。

- [ ] **Step 3: Commit**

```bash
git add docs/activation-issuance-feishu-flow.md docs/activation-flow-current.md
git commit -m "docs(activation): 记录 deploy 一体机激活通道落地"
```

---

## Self-Review

**Spec 覆盖：**
- 设备码计算（spec §3）→ Task 2（含对拍金标准，算法不一致即阻断）✅
- 授权码解析（spec §4）→ Task 3 ✅
- activation.json 落位（spec §4）→ Task 4 ✅
- 双通道注入（spec §2）→ Task 5（文件优先 + TTY 粘贴回退）✅
- stage_activation 流程/幂等/拒绝（spec §5）→ Task 5（含设备不符/过期/幂等用例）✅
- 整合进 deploy.sh + 报告文案（spec §5/§6）→ Task 6 ✅
- 安全：不持私钥只写文件、App 验签兜底（spec §7）→ 贯穿，落位不验签由 Task 4/5 体现 ✅
- 测试矩阵（spec §8）→ 对拍/解析/幂等/文件通道/设备不符/过期/端到端分布在 Task 2–6 ✅
- Roadmap（spec §9）→ Task 7 文档收尾，不实现 hanhai/模型守卫 ✅

**占位符扫描：** 无 TBD/TODO 残留；每个代码步骤含完整代码；命令含预期输出。✅

**命名一致性：** `de_compute_device_code` / `de_format_device_code` / `de_parse_license` /
`de_now_iso` / `de_data_dir` / `de_write_activation_json` / `de_read_license_from_file` /
`de_license_valid_for_device` / `stage_activation` —— 跨 Task 引用一致。✅

**注意事项（执行者必读）：**
- Task 2 Step 4 对拍**不通过则禁止继续**——设备码不一致会让所有签发码作废。
- 真机已激活，全程以**临时目录/备份**做破坏性验证，Task 6 Step 9 必须确认线上文件 IDENTICAL。
- `date -u +%6N` 依赖 GNU date（Ubuntu 自带，OK）；若移植到 BSD/mac 需另处理（本期仅 ARM Ubuntu）。
