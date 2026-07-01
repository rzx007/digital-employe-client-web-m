# deploy.sh 激活阶段设计

> 日期：2026-06-16
> 目标：给一体机安装器 `deploy.sh` 增加「激活阶段」，把
> 「算设备码 → 飞书换码 → 落激活码」这条链在安装器里串起来（仅数字员工）。
> 关联：[激活流程现状](../../activation-flow-current.md) ·
> [飞书签发运维流程](../../activation-issuance-feishu-flow.md)

## 1. 背景（真机已核实，10.172.246.220）

一体机离线安装包 `BobanStaff-Installer/`，`deploy.sh` 现有 5 阶段（模型→数字员工→
瀚海CLI→桌面→输入法），**全程无激活逻辑**。

三个软件的激活现实：

| 软件 | 形态 | 激活校验 |
|------|------|---------|
| **数字员工** | Electron App（`/opt/BobanStaff/`），内嵌 PyInstaller 后端 `resources/py-server/backend`（单文件 ELF），App 启动时拉起，监听动态端口（实测 `127.0.0.1:34555`） | ✅ **唯一**读 `~/.digital-employee/data/activation.json` 验签 |
| **hanhai-cli** | Node（`~/BobanStaff/hanhai-cli`） | ❌ 无（本期 TODO） |
| **模型/llama.cpp** | docker compose + gguf | ❌ 无（本期 TODO） |

关键约束（决定方案形态）：
- **后端只在 App 打开时才起、端口动态** → deploy（命令行/可能无图形会话）**不能稳定走 HTTP**
  调 `/activation/device`、`/activation/activate`。
- **backend 是 stripped 单文件 ELF** → 无法 `python3 -c` 调用其内部 `compute_local_device_code`。
- **但激活本质是文件**：`activation.json` 是普通 JSON，授权码已被私钥签名；
  deploy **直接写对这个文件即可**，下次 App 启动自行 `verify_license` 校验。deploy 不需验签。

## 2. 本期范围

**只做**：`deploy.sh` 新增「激活阶段」，服务数字员工一个。

**双通道注入**（前瞻：以后可能不在终端激活）：
1. **文件优先**：约定路径存在授权码文件 → 读它（无人值守通道）。
2. **回退终端粘贴**：文件无 → 交互式提示粘入（现场应急通道）。

**明确不做（写入 roadmap）**：hanhai-cli 验签、模型层守卫。放了码这俩也不看，仍裸奔。

## 3. 设备码计算（一致性是最大风险）

数字员工设备码算法（`activation_core.device.compute_local_device_code`）：

```
mac      = uuid.getnode()                      # 48-bit
mac_hex  = f"{mac:012x}"
machine  = /etc/machine-id (或 /var/lib/dbus/machine-id) 内容 strip
raw      = f"{mac_hex}|{machine}"
digest   = sha256(raw.encode()).hexdigest()
device   = digest[:20].upper()                 # 20 hex 大写
显示格式  = 每 4 位插 "-"  → XXXX-XXXX-XXXX-XXXX-XXXX
```

> ⚠️ **deploy 必须字节级复刻此算法**，否则算出的设备码 ≠ App 算的 → 飞书签出的码
> 在 App 里 `device_mismatch`。

**实现方式**：deploy 用**自包含 python3 内联脚本**计算（系统有 `python3 3.12`），
不重写成 bash（bash 取 MAC/SHA256 易出偏差）。脚本严格照上式：

```bash
de_compute_device_code() {
  python3 - <<'PY'
import hashlib, uuid, sys
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
print(hashlib.sha256(raw.encode()).hexdigest()[:20].upper())
PY
}
de_format_device_code() {  # 20 hex → XXXX-XXXX-...
  echo "$1" | sed 's/.\{4\}/&-/g; s/-$//'
}
```

> 校验自洽：本机 `de_compute_device_code` 的输出，应等于现有 `activation.json` 里的
> `device_code`（`3E5677F8E9179E207A30`）。实施时**先在 220 上跑这段对拍**，
> 相等才算法正确，再继续。

## 4. 授权码 → activation.json 落位

`activation.json` 结构（`ActivationRecord`）：

```json
{
  "device_code": "<20 hex 无分隔>",
  "license_code": "<授权码字符串 base64url(payload).base64url(sig)>",
  "expires_at": "<ISO，取自授权码 payload.exp>",
  "activated_at": "<ISO，写入当下>",
  "last_seen_at": "<ISO，写入当下>"
}
```

授权码 payload 解析（无需私钥/公钥，纯 base64url+json）：

```bash
de_parse_license() {   # 入参=授权码；输出: "<device_in_code>\t<exp>"
  python3 - "$1" <<'PY'
import sys, json, base64
code = sys.argv[1].strip()
b64 = code.split(".", 1)[0]
b64 += "=" * (-len(b64) % 4)
p = json.loads(base64.urlsafe_b64decode(b64))
print(f'{p["d"]}\t{p["exp"]}')
PY
}
```

落位（deploy 直接写文件，不依赖 App/后端）：
- 路径：`/home/${DE_USER}/.digital-employee/data/activation.json`（与 App `getDataDir()` 一致）。
- 写前 `mkdir -p` 父目录；写后 `chown ${DE_USER}:${DE_USER}`。
- `activated_at` / `last_seen_at` 用 `date -u +%Y-%m-%dT%H:%M:%S.%6NZ`。

> 设备绑定校验仍由 App 启动时做：写进文件的 `device_code` 必须 == 本机实算设备码，
> deploy 用第 3 节算出的值填，保证一致。

## 5. 激活阶段流程（插入到 stage_digital_employee 之后）

新函数 `stage_activation()`，在 `main()` 里 `stage_digital_employee` 之后、
`stage_hanhai_cli` 之前调用。阶段号顺延（数字员工后变 5 阶段→6 阶段，文案相应调整）。

```
stage_activation:
  1. 算本机设备码 dev = de_compute_device_code; disp = de_format_device_code(dev)
  2. 幂等：若 activation.json 已存在且其 device_code == dev 且 expires_at 未过期
       → record activation SKIP "已激活，有效期至 <exp>"; 打印 disp; return
  3. 醒目打印设备码 disp（写入安装报告），提示「凭此码去飞书换激活码」
  4. 取激活码（双通道）：
     a. 文件优先：LICENSE_FILE 候选按序探测，第一行非空即授权码
        候选：${PKG_DIR}/activation.md、${INSTALLER_DIR}/activation.code、
              /home/${DE_USER}/BobanStaff/activation/license.code
     b. 文件无 → 若 stdin 是 TTY：交互提示「粘入授权码（回车结束，留空跳过）」读一行
        非 TTY 且无文件 → record activation WARN「未激活：无授权码来源」+ 指引；return
  5. 校验拿到的码：de_parse_license → (code_dev, exp)
     - code_dev 必须 == dev（去分隔符比较），否则 record WARN「授权码非本机设备」；return
     - exp 必须晚于当前 UTC，否则 record WARN「授权码已过期」；return
  6. 落位：写 activation.json（第 4 节），chown
  7. record activation OK「已激活，有效期至 <exp>」
```

第一次跑（无码）：走到 3→4b，打印设备码 + WARN「拿码后放文件或重跑粘贴」。
第二次跑（有码）：3→4a/4b 拿到码→校验→落位→OK。

## 6. 报告与文案

- `status_label` 增 `activation) echo "数字员工激活";;`
- 阶段计数：现有 "阶段 N/5" 文案随新增阶段调整为 /6。
- 报告尾部增一行：未激活时显示设备码与「去飞书换码」指引。

## 7. 安全

- deploy **不持私钥、不验签**，只写文件；私钥仍只在独立签发服务。
- 授权码文件（如 `activation.md`）在安装目录内，随 `--cleanup` 一并删除，不残留客户机。
- 设备绑定 + 过期由 App 启动时 `verify_license` 兜底：deploy 写错/写假的码，App 仍会拒绝。

## 8. 测试（在 220 真机 + 可复现脚本）

> deploy 是 bash + 真机环境，单测有限；以「可复现的命令级验证」为主。

1. **设备码对拍**：`de_compute_device_code` 输出 == 现有 `activation.json.device_code`
   （`3E5677F8E9179E207A30`）。**不等则算法错，阻断后续。**
2. **payload 解析**：`de_parse_license <现有 license_code>` 输出 `d` ==
   `3E5677F8E9179E207A30`、`exp` == `2027-06-06T09:46:23.027754Z`。
3. **幂等**：已激活态跑 `stage_activation` → SKIP，不改 `activation.json`（mtime 不变）。
4. **文件通道**：删 `activation.json`，把现有授权码写入候选文件 → 跑 → 重新生成
   `activation.json` 且内容正确、属主 boban。
5. **设备不匹配拒绝**：构造一个别的设备码的授权码 → 校验阶段 WARN，不落位。
6. **过期拒绝**：构造已过期 exp 的 payload → WARN，不落位。
7. **端到端**：清空激活 → 跑 deploy → 打开 App → 显示已激活。
   （测试需备份现有 `activation.json`，测后还原，避免破坏已交付机器。）

## 9. Roadmap（本期不做）

- **hanhai-cli（Node）**：启动读同一证书、内置 `crypto` 验 Ed25519、内嵌同一公钥。
- **模型/llama.cpp**：守卫——激活通过才 `docker compose up`（在 `stage_model` 前置门槛）。
- **证书中立化**：证书统一到 `~/BobanStaff/activation/`（见
  [中立化 spec](./2026-06-16-neutral-license-cert-multi-program-design.md)），
  deploy 落位路径与各程序读取路径随之统一。本期仍写 App 现路径
  `~/.digital-employee/data/activation.json`，避免一次改太多。

## 10. 待确认

- 授权码文件候选名/位置是否就用 `packages/activation.md`（现有）+ 一个新候选。
- 阶段插入位置（数字员工之后）是否 OK，还是希望放在最前（未激活就不装其他）。
